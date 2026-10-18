import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { verifyJoinToken } from "../joinToken.js";
import { applyControl, handlePlaybackError } from "./control.js";
import { clientMessageSchema } from "./protocol.js";
import { onSessionChange, serializeForClient, type Session } from "./session.js";
import { getSession } from "./store.js";

const HELLO_TIMEOUT_MS = 5_000;

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
      clients.set(ws, { id: randomUUID(), ...(displayName ? { displayName } : {}) });
      session.clients.add(ws);
      send(ws, stateMessage(session));
      broadcastPresence(session);
      return;
    }

    if (!session) return;
    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong", t0: msg.t0, serverMs: Date.now() });
        return;
      case "control":
        applyControl(session, msg.action);
        return;
      case "playbackError":
        handlePlaybackError(session, clients.get(ws)!.id, msg.videoId, msg.code);
        return;
    }
  });

  ws.on("close", () => {
    clearTimeout(helloTimer);
    if (!session) return;
    session.clients.delete(ws);
    broadcastPresence(session);
  });
}
