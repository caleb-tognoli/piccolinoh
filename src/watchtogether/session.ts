import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";

export interface Track {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
}

export interface CurrentTrack extends Track {
  startedAtServerMs: number;
  pausedAtPositionSec?: number;
}

export interface Session {
  id: string;
  guildId: string;
  /** Bumped on every timeline change (track, play/pause, seek) so clients can drop stale state. */
  epoch: number;
  current?: CurrentTrack;
  queue: Track[];
  history: Track[];
  /** When false, playback stops after each track instead of advancing the queue. */
  autoplay: boolean;
  advanceTimer?: NodeJS.Timeout;
  clients: Set<WebSocket>;
  /** videoId -> client ids that reported the video as unembeddable. */
  errorTally: Map<string, Set<string>>;
}

export type SerializedSession = Omit<Session, "advanceTimer" | "clients" | "errorTally">;

export function createSession(guildId: string): Session {
  return {
    id: randomBytes(9).toString("base64url"),
    guildId,
    epoch: 0,
    queue: [],
    history: [],
    autoplay: true,
    clients: new Set(),
    errorTally: new Map(),
  };
}

export function serializeForClient(session: Session): SerializedSession {
  const { advanceTimer: _t, clients: _c, errorTally: _e, ...rest } = session;
  return rest;
}

type Listener = (session: Session) => void;
const listeners = new Set<Listener>();

export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifySessionChange(session: Session): void {
  for (const fn of listeners) fn(session);
}
