import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { type JoinIdentity, signJoinToken, verifyJoinToken } from "../joinToken.js";
import { logger } from "../logger.js";
import { applyControl, handlePlaybackError, setAutoplay } from "./control.js";
import { handlePlaylistRequest, playlistDetail, playlistSummaries, type Reply } from "./playlistApi.js";
import { getPlaylist, onPlaylistChange, playlistsOpen } from "./playlists.js";
import type { LookupEntry } from "./lookups.js";
import { recordListener, setViewerSource } from "./plays.js";
import { clientMessageSchema } from "./protocol.js";
import { onSessionChange, serializeForClient, type Session } from "./session.js";
import { findSessionForGuild, getSession } from "./store.js";

const HELLO_TIMEOUT_MS = 5_000;
/** Well inside the token's hour, so a connected browser always holds a valid one. */
export const TOKEN_REFRESH_MS = 20 * 60_000;

function freshToken(session: Session, who: JoinIdentity): () => string {
  const uid = who.userId ? { uid: who.userId } : {};
  return () => signJoinToken({ sid: session.id, gid: session.guildId, dn: who.name, ...uid });
}

interface Client {
  id: string;
  displayName?: string;
  /** Discord user id, from a join link that carried one. Never sent to browsers. */
  userId?: string;
  /** The playlist whose tracks this browser is sent as they change. */
  following?: number;
  /** Videos it looked up lately, so it can queue or save them by id. */
  lookups: Map<string, LookupEntry>;
}

const clients = new WeakMap<WebSocket, Client>();

setViewerSource((session) => [...session.clients].flatMap((ws) => clients.get(ws)?.userId ?? []));

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(session: Session, payload: unknown): void {
  for (const ws of session.clients) send(ws, payload);
}

function stateMessage(session: Session) {
  return { type: "state", session: serializeForClient(session), serverMs: Date.now() };
}

function broadcastPresence(session: Session): void {
  const members = [...session.clients].map((ws) => {
    const { id, displayName } = clients.get(ws)!;
    return displayName ? { id, displayName } : { id };
  });
  broadcast(session, { type: "presence", members });
}

onSessionChange((session) => broadcast(session, stateMessage(session)));

function playlistsMessage(session: Session) {
  return { type: "playlists", playlists: playlistsOpen() ? playlistSummaries(session.guildId) : [] };
}

// Every browser in the room gets the list; those viewing a playlist get its tracks.
onPlaylistChange((guildId, playlistId, gone) => {
  const session = findSessionForGuild(guildId);
  if (!session) return;
  broadcast(session, playlistsMessage(session));
  const watchers = [...session.clients].filter((ws) => clients.get(ws)?.following === playlistId);
  if (watchers.length === 0) return;
  const playlist = gone ? undefined : getPlaylist(playlistId);
  const payload = playlist ? { type: "playlist", playlist: playlistDetail(playlist) } : { type: "playlistGone", playlistId };
  for (const ws of watchers) {
    if (!playlist) delete clients.get(ws)!.following;
    send(ws, payload);
  }
});

export function attachSocket(ws: WebSocket): void {
  let session: Session | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  const helloTimer = setTimeout(() => ws.close(1008, "no hello"), HELLO_TIMEOUT_MS);

  ws.on("message", (raw: Buffer) => {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const msg = parsed.data;

    if (msg.type === "hello") {
      if (session) return;
      clearTimeout(helloTimer);
      session = getSession(msg.sessionId);
      if (!session) {
        ws.close(1008, "invalid session");
        return;
      }
      const who = msg.joinToken ? verifyJoinToken(msg.joinToken, { sid: session.id, gid: session.guildId }) : null;
      const id = randomUUID();
      clients.set(ws, {
        id,
        ...(who ? { displayName: who.name } : {}),
        ...(who?.userId ? { userId: who.userId } : {}),
        lookups: new Map(),
      });
      session.clients.add(ws);
      if (who?.userId) recordListener(session, who.userId);
      // Lets the browser find itself in presence lists. A named browser also
      // gets a fresh token now and every so often, so reconnecting after the
      // link's hour is up doesn't turn it into a guest.
      const fresh = who ? freshToken(session, who) : undefined;
      // canEdit: playlists (and adding tracks) need a Discord id.
      send(ws, { type: "welcome", clientId: id, canEdit: Boolean(who?.userId), ...(fresh ? { joinToken: fresh() } : {}) });
      if (fresh) refreshTimer = setInterval(() => send(ws, { type: "joinToken", joinToken: fresh() }), TOKEN_REFRESH_MS);
      send(ws, stateMessage(session));
      send(ws, playlistsMessage(session));
      broadcastPresence(session);
      return;
    }

    if (!session) return;
    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong", t0: msg.t0, serverMs: Date.now() });
        return;
      case "control": {
        const { displayName, userId } = clients.get(ws)!;
        const by = { ...(displayName ? { by: displayName } : {}), ...(userId ? { userId } : {}) };
        if (msg.action.kind === "autoplayOn") setAutoplay(session, true, by);
        else applyControl(session, msg.action, by);
        return;
      }
      case "request": {
        const client = clients.get(ws)!;
        const caller = {
          session,
          ...(client.displayName ? { name: client.displayName } : {}),
          ...(client.userId ? { userId: client.userId } : {}),
          lookups: client.lookups,
        };
        const follow = (playlistId: number | null) => {
          if (playlistId === null) delete client.following;
          else client.following = playlistId;
        };
        void handlePlaylistRequest(caller, msg.request, follow)
          .catch((err: unknown): Reply => {
            logger.error({ err, request: msg.request.kind }, "site request failed");
            return { ok: false, error: "Something went wrong." };
          })
          .then((reply) => send(ws, { type: "reply", id: msg.id, ...reply }));
        return;
      }
      case "playbackError":
        handlePlaybackError(session, clients.get(ws)!.id, msg.videoId, msg.code);
        return;
    }
  });

  ws.on("close", () => {
    clearTimeout(helloTimer);
    clearInterval(refreshTimer);
    if (!session) return;
    session.clients.delete(ws);
    broadcastPresence(session);
  });
}
