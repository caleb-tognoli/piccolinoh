import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { signJoinToken, verifyJoinToken } from "../joinToken.js";
import { applyControl, handlePlaybackError, setAutoplay } from "./control.js";
import { clientMessageSchema } from "./protocol.js";
import { onSessionChange, serializeForClient, type Session } from "./session.js";
import { getSession } from "./store.js";

const HELLO_TIMEOUT_MS = 5_000;
/** Well inside the token's hour, so a connected browser always holds a valid one. */
export const TOKEN_REFRESH_MS = 20 * 60_000;

function freshToken(session: Session, displayName: string): () => string {
  return () => signJoinToken({ sid: session.id, gid: session.guildId, dn: displayName });
}

interface Client {
  id: string;
  displayName?: string;
}

const clients = new WeakMap<WebSocket, Client>();

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
  const members = [...session.clients].map((ws) => clients.get(ws)!);
  broadcast(session, { type: "presence", members });
}

onSessionChange((session) => broadcast(session, stateMessage(session)));

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
      const displayName = msg.joinToken
        ? verifyJoinToken(msg.joinToken, { sid: session.id, gid: session.guildId })
        : null;
      const id = randomUUID();
      clients.set(ws, { id, ...(displayName ? { displayName } : {}) });
      session.clients.add(ws);
      // Lets the browser find itself in presence lists. A named browser also
      // gets a fresh token now and every so often, so reconnecting after the
      // link's hour is up doesn't turn it into a guest.
      const fresh = displayName ? freshToken(session, displayName) : undefined;
      send(ws, { type: "welcome", clientId: id, ...(fresh ? { joinToken: fresh() } : {}) });
      if (fresh) refreshTimer = setInterval(() => send(ws, { type: "joinToken", joinToken: fresh() }), TOKEN_REFRESH_MS);
      send(ws, stateMessage(session));
      broadcastPresence(session);
      return;
    }

    if (!session) return;
    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong", t0: msg.t0, serverMs: Date.now() });
        return;
      case "control": {
        const { displayName } = clients.get(ws)!;
        const by = displayName ? { by: displayName } : {};
        if (msg.action.kind === "autoplayOn") setAutoplay(session, true, by);
        else applyControl(session, msg.action, by);
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
