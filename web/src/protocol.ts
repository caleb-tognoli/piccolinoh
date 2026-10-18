// Mirrors src/watchtogether/{session,protocol}.ts.

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

export interface SerializedSession {
  id: string;
  guildId: string;
  epoch: number;
  current?: CurrentTrack;
  queue: Track[];
  history: Track[];
  autoplay: boolean;
}

export type ControlAction =
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "skip" }
  | { kind: "seek"; toSec: number }
  | { kind: "remove"; index: number };

export type ClientMessage =
  | { type: "hello"; sessionId: string; joinToken?: string }
  | { type: "ping"; t0: number }
  | { type: "control"; action: ControlAction }
  | { type: "playbackError"; videoId: string; code: number };

export interface PresenceMember {
  id: string;
  displayName?: string;
}

export type ServerMessage =
  | { type: "state"; session: SerializedSession; serverMs: number }
  | { type: "presence"; members: PresenceMember[] }
  | { type: "pong"; t0: number; serverMs: number };
