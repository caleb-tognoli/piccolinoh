import type { ClientMessage, ServerMessage } from "./protocol";
import { connected, serverOffset } from "./store";

type ServerType = ServerMessage["type"];
type Handler<T extends ServerType> = (msg: Extract<ServerMessage, { type: T }>) => void;

export interface WSClient {
  send(msg: ClientMessage): void;
  on<T extends ServerType>(type: T, handler: Handler<T>): () => void;
  close(): void;
}

// The server closes with this when the session id is unknown (expired link,
// or the process restarted and dropped its in-memory sessions).
const CLOSE_REJECTED = 1008;

/**
 * A WebSocket that reconnects with backoff; `onOpen` runs on every (re)connect.
 * Stops reconnecting and calls `onRejected` if the server refuses the session.
 */
export function connect(url: string, onOpen: () => void, onRejected: () => void): WSClient {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let backoff = 250;
  const handlers = new Map<ServerType, Set<(msg: ServerMessage) => void>>();

  const open = (): void => {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      backoff = 250;
      connected.value = true;
      onOpen();
    });
    socket.addEventListener("close", (ev) => {
      if (closedByUser) return;
      if (ev.code === CLOSE_REJECTED) {
        closedByUser = true;
        onRejected();
        return;
      }
      connected.value = false;
      setTimeout(open, backoff);
      backoff = Math.min(5000, backoff * 2);
    });
    socket.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      for (const h of handlers.get(msg.type) ?? []) {
        try {
          h(msg);
        } catch (err) {
          console.error("handler threw", err);
        }
      }
    });
  };
  open();

  return {
    send(msg) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    },
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      const h = handler as (msg: ServerMessage) => void;
      set.add(h);
      return () => set.delete(h);
    },
    close() {
      closedByUser = true;
      socket?.close();
    },
  };
}

const PING_COUNT = 5;
const RESAMPLE_MS = 60_000;

/** Estimates the server clock offset from the median of a few ping round-trips, once a minute. */
export function startClockSync(ws: WSClient): () => void {
  const sample = (): void => {
    const offsets: number[] = [];
    const unsub = ws.on("pong", (msg) => {
      const rtt = performance.now() - msg.t0;
      offsets.push(msg.serverMs - (msg.t0 + rtt / 2));
      if (offsets.length < PING_COUNT) return;
      unsub();
      serverOffset.value = offsets.sort((a, b) => a - b)[Math.floor(PING_COUNT / 2)]!;
    });
    for (let i = 0; i < PING_COUNT; i++) ws.send({ type: "ping", t0: performance.now() });
  };
  sample();
  const interval = window.setInterval(sample, RESAMPLE_MS);
  return () => window.clearInterval(interval);
}

export function serverNow(): number {
  return performance.now() + serverOffset.value;
}
