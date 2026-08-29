import { EventEmitter } from "node:events";
import type { Session, SerializedSession } from "./session.js";
import { serializeForClient } from "./session.js";

type SessionEvents = {
  stateChanged: [session: Session];
  queueChanged: [session: Session];
};

class SessionEmitter extends EventEmitter {
  override emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof SessionEvents>(
    event: K,
    listener: (...args: SessionEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof SessionEvents>(
    event: K,
    listener: (...args: SessionEvents[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export const sessionEmitter = new SessionEmitter();
sessionEmitter.setMaxListeners(200);

export function subscribeToSession(
  sessionId: string,
  cb: (session: SerializedSession) => void,
): () => void {
  const listener = (session: Session): void => {
    if (session.id === sessionId) cb(serializeForClient(session));
  };
  sessionEmitter.on("stateChanged", listener);
  sessionEmitter.on("queueChanged", listener);
  return () => {
    sessionEmitter.off("stateChanged", listener);
    sessionEmitter.off("queueChanged", listener);
  };
}
