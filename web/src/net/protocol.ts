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
  autoplay: boolean;
}

export interface SerializedSession {
  id: string;
  guildId: string;
  epoch: number;
  current?: CurrentTrack;
  queue: QueueItem[];
  history: QueueItem[];
  settings: SessionSettings;
}

export type ControlAction =
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "skip" }
  | { kind: "seek"; toSec: number }
  | { kind: "enqueue"; videoId: string; durationSec: number }
  | { kind: "remove"; index: number }
  | { kind: "reorder"; from: number; to: number }
  | { kind: "clear" };

export type ClientMessage =
  | { type: "hello"; sessionToken: string; joinToken?: string }
  | { type: "ping"; t0: number }
  | { type: "requestState" }
  | { type: "control"; action: ControlAction }
  | { type: "playbackError"; videoId: string; code: number };

export interface PresenceMember {
  id: string;
  displayName?: string;
}

export type ServerMessage =
  | { type: "state"; session: SerializedSession; serverMs: number }
  | { type: "queueUpdate"; queue: QueueItem[] }
  | { type: "presence"; members: PresenceMember[] }
  | { type: "pong"; t0: number; serverMs: number };
