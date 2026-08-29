import type { ClientMessage, ServerMessage } from "./protocol";

type ServerType = ServerMessage["type"];
type MessageOf<T extends ServerType> = Extract<ServerMessage, { type: T }>;
export type ServerHandler<T extends ServerType> = (msg: MessageOf<T>) => void;

export interface WSClient {
  send(msg: ClientMessage): void;
  on<T extends ServerType>(type: T, handler: ServerHandler<T>): () => void;
  close(): void;
}

export interface ConnectOptions {
  onOpen?: () => void;
  onReconnect?: () => void;
}

export function connect(url: string, options: ConnectOptions = {}): WSClient {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let backoff = 250;
  let firstOpen = true;
  const handlers = new Map<ServerType, Set<ServerHandler<ServerType>>>();

  const open = (): void => {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      backoff = 250;
      if (firstOpen) {
        options.onOpen?.();
        firstOpen = false;
      } else {
        options.onReconnect?.();
      }
    });
    socket.addEventListener("close", () => {
      if (closedByUser) return;
      setTimeout(open, backoff);
      backoff = Math.min(5000, backoff * 2);
    });
    socket.addEventListener("error", (e) => {
      console.warn("ws error", e);
    });
    socket.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      const set = handlers.get(msg.type);
      if (!set) return;
      for (const h of set) {
        try {
          h(msg as never);
        } catch (err) {
          console.error("handler threw", err);
        }
      }
    });
  };

  open();

  return {
    send(msg) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as unknown as ServerHandler<ServerType>);
      return () => {
        set!.delete(handler as unknown as ServerHandler<ServerType>);
      };
    },
    close() {
      closedByUser = true;
      socket?.close();
    },
  };
}
