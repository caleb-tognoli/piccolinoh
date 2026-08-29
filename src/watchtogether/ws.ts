import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { logger } from "../logger.js";
import { applyControl, handlePlaybackError } from "./control.js";
import { sessionEmitter } from "./events.js";
import type { ClientMessage } from "./protocol.js";
import { clientMessageSchema } from "./protocol.js";
import type { Session } from "./session.js";
import { serializeForClient } from "./session.js";
import { getSession } from "./store.js";

const HELLO_TIMEOUT_MS = 5_000;

const clientIds = new WeakMap<WebSocket, string>();

function getClientId(ws: WebSocket): string {
  let id = clientIds.get(ws);
  if (!id) {
    id = randomUUID();
    clientIds.set(ws, id);
  }
  return id;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err }, "ws send failed");
  }
}

function broadcast(session: Session, msg: string): void {
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

sessionEmitter.on("stateChanged", (session) => {
  broadcast(
    session,
    JSON.stringify({
      type: "state",
      session: serializeForClient(session),
      serverMs: Date.now(),
    }),
  );
});

sessionEmitter.on("queueChanged", (session) => {
  broadcast(
    session,
    JSON.stringify({ type: "queueUpdate", queue: session.queue }),
  );
});

function broadcastPresence(session: Session): void {
  const members = [...session.clients].map((ws) => ({ id: getClientId(ws) }));
  broadcast(session, JSON.stringify({ type: "presence", members }));
}

export function attachSocket(ws: WebSocket): void {
  let attached: { session: Session } | null = null;
  const helloTimer = setTimeout(() => {
    if (!attached && ws.readyState === WebSocket.OPEN) {
      ws.close(1008, "no hello");
    }
  }, HELLO_TIMEOUT_MS);

  ws.on("message", (raw: Buffer) => {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const msg: ClientMessage = parsed.data;

    if (msg.type === "hello") {
      if (attached) return;
      const session = getSession(msg.sessionToken);
      if (!session) {
        clearTimeout(helloTimer);
        ws.close(1008, "invalid session");
        return;
      }
      clearTimeout(helloTimer);
      getClientId(ws);
      session.clients.add(ws);
      attached = { session };
      sendJson(ws, {
        type: "state",
        session: serializeForClient(session),
        serverMs: Date.now(),
      });
      broadcastPresence(session);
      return;
    }

    if (!attached) return;
    const session = attached.session;

    switch (msg.type) {
      case "ping":
        sendJson(ws, { type: "pong", t0: msg.t0, serverMs: Date.now() });
        return;
      case "requestState":
        sendJson(ws, {
          type: "state",
          session: serializeForClient(session),
          serverMs: Date.now(),
        });
        return;
      case "control":
        applyControl(session, msg.action);
        return;
      case "playbackError":
        handlePlaybackError(session, getClientId(ws), msg.videoId, msg.code);
        return;
    }
  });

  ws.on("close", () => {
    clearTimeout(helloTimer);
    if (!attached) return;
    attached.session.clients.delete(ws);
    broadcastPresence(attached.session);
  });
}
