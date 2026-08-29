import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";

export interface QueueItem {
  videoId: string;
  durationSec: number;
  requestedBy: string;
}

export interface CurrentTrack {
  videoId: string;
  durationSec: number;
  startedAtServerMs: number;
  pausedAtPositionSec?: number;
  requestedBy: string;
}

export interface SessionSettings {
  skipMode: "anyone" | "vote" | "dj";
  voteThreshold: number;
}

export interface Session {
  id: string;
  guildId: string;
  epoch: number;
  current?: CurrentTrack;
  queue: QueueItem[];
  history: QueueItem[];
  settings: SessionSettings;
  advanceTimer?: NodeJS.Timeout;
  clients: Set<WebSocket>;
  errorTally: Map<string, Set<string>>;
}

export type SerializedSession = Omit<Session, "advanceTimer" | "clients" | "errorTally">;

export function makeSessionId(): string {
  return randomBytes(9).toString("base64url");
}

export function createSession(guildId: string): Session {
  return {
    id: makeSessionId(),
    guildId,
    epoch: 0,
    queue: [],
    history: [],
    settings: { skipMode: "anyone", voteThreshold: 0.5 },
    clients: new Set(),
    errorTally: new Map(),
  };
}

export function serializeForClient(session: Session): SerializedSession {
  const { advanceTimer: _t, clients: _c, errorTally: _e, ...rest } = session;
  return rest;
}
