import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { logger } from "../logger.js";
import type { ClientMessage, ControlAction } from "./protocol.js";
import { clientMessageSchema } from "./protocol.js";
import type { Session } from "./session.js";
import { serializeForClient } from "./session.js";
import { getSession } from "./store.js";
import { advance, derivePosition, scheduleAdvance } from "./timeline.js";

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

export function broadcastState(session: Session): void {
  const payload = {
    type: "state" as const,
    session: serializeForClient(session),
    serverMs: Date.now(),
  };
  const msg = JSON.stringify(payload);
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function broadcastQueueUpdate(session: Session): void {
  const msg = JSON.stringify({ type: "queueUpdate", queue: session.queue });
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function broadcastPresence(session: Session): void {
  const members = [...session.clients].map((ws) => ({ id: getClientId(ws) }));
  const msg = JSON.stringify({ type: "presence", members });
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function applyControl(session: Session, action: ControlAction): void {
  switch (action.kind) {
    case "play": {
      if (!session.current) return;
      if (session.current.pausedAtPositionSec == null) return;
      const now = Date.now();
      session.current.startedAtServerMs = now - session.current.pausedAtPositionSec * 1000;
      session.current.pausedAtPositionSec = undefined;
      session.epoch += 1;
      scheduleAdvance(session, broadcastState);
      broadcastState(session);
      return;
    }
    case "pause": {
      if (!session.current || session.current.pausedAtPositionSec != null) return;
      session.current.pausedAtPositionSec = derivePosition(session, Date.now());
      session.epoch += 1;
      scheduleAdvance(session, broadcastState);
      broadcastState(session);
      return;
    }
    case "skip": {
      advance(session);
      scheduleAdvance(session, broadcastState);
      broadcastState(session);
      return;
    }
    case "seek": {
      if (!session.current) return;
      const clamped = Math.max(0, Math.min(action.toSec, session.current.durationSec));
      if (session.current.pausedAtPositionSec != null) {
        session.current.pausedAtPositionSec = clamped;
      } else {
        session.current.startedAtServerMs = Date.now() - clamped * 1000;
      }
      session.epoch += 1;
      scheduleAdvance(session, broadcastState);
      broadcastState(session);
      return;
    }
    case "enqueue": {
      const item = {
        videoId: action.videoId,
        durationSec: action.durationSec,
        requestedBy: "anonymous",
      };
      if (!session.current) {
        session.current = {
          ...item,
          startedAtServerMs: Date.now(),
        };
        session.epoch += 1;
        scheduleAdvance(session, broadcastState);
        broadcastState(session);
      } else {
        session.queue.push(item);
        broadcastQueueUpdate(session);
      }
      return;
    }
    case "remove": {
      if (action.index >= session.queue.length) return;
      session.queue.splice(action.index, 1);
      broadcastQueueUpdate(session);
      return;
    }
    case "reorder": {
      const { from, to } = action;
      if (from >= session.queue.length || to >= session.queue.length) return;
      const [item] = session.queue.splice(from, 1);
      if (!item) return;
      session.queue.splice(to, 0, item);
      broadcastQueueUpdate(session);
      return;
    }
  }
}

function handlePlaybackError(
  session: Session,
  ws: WebSocket,
  videoId: string,
  code: number,
): void {
  if (!session.current || session.current.videoId !== videoId) return;
  const clientId = getClientId(ws);
  let set = session.errorTally.get(videoId);
  if (!set) {
    set = new Set();
    session.errorTally.set(videoId, set);
  }
  set.add(clientId);
  const half = session.clients.size / 2;
  if (set.size > half) {
    logger.info(
      { videoId, code, votes: set.size, clients: session.clients.size },
      "auto-skip: majority reported embed-disabled",
    );
    advance(session);
    scheduleAdvance(session, broadcastState);
    broadcastState(session);
  }
}

export interface AttachedSession {
  session: Session;
  clientId: string;
}

export function attachSocket(ws: WebSocket): void {
  let attached: AttachedSession | null = null;
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
      const clientId = getClientId(ws);
      session.clients.add(ws);
      attached = { session, clientId };
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
        handlePlaybackError(session, ws, msg.videoId, msg.code);
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
