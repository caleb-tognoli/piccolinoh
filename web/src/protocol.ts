// Mirrors src/watchtogether/{session,protocol}.ts.

export interface Track {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  startSec?: number;
  addedBy?: { userId: string; name: string };
  fromPlaylist?: { id: number; name: string };
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
  | { kind: "remove"; index: number }
  | { kind: "restore"; videoId: string }
  | { kind: "reorder"; from: number; to: number }
  | { kind: "autoplayOn" };

export type PlaylistRequest =
  | { kind: "openPlaylist"; playlistId: number | null }
  | { kind: "createPlaylist"; name: string }
  | { kind: "renamePlaylist"; playlistId: number; name: string }
  | { kind: "deletePlaylist"; playlistId: number }
  | { kind: "queuePlaylist"; playlistId: number; next: boolean; shuffle: boolean }
  | { kind: "queuePlaylistTrack"; playlistId: number; index: number; videoId: string; next: boolean }
  | { kind: "movePlaylistTrack"; playlistId: number; from: number; to: number; videoId: string }
  | { kind: "removePlaylistTrack"; playlistId: number; index: number; videoId: string }
  | { kind: "restorePlaylistTrack"; playlistId: number; videoId: string }
  | { kind: "addToPlaylist"; playlistId: number; videoIds: string[] }
  | { kind: "playlistsWith"; videoId: string }
  | { kind: "lookup"; query: string }
  | { kind: "enqueueVideo"; videoId: string; next: boolean }
  | { kind: "addCollection"; query: string; next: boolean; shuffle?: boolean; playlistId: number | null };

export interface PlaylistSummary {
  id: number;
  name: string;
  trackCount: number;
  durationSec: number;
}

export interface PlaylistTrack {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
}

export interface PlaylistDetail {
  id: number;
  name: string;
  tracks: PlaylistTrack[];
}

export type ClientMessage =
  | { type: "hello"; sessionId: string; joinToken?: string }
  | { type: "ping"; t0: number }
  | { type: "control"; action: ControlAction }
  | { type: "request"; id: number; request: PlaylistRequest }
  | { type: "playbackError"; videoId: string; code: number };

export interface PresenceMember {
  id: string;
  displayName?: string;
}

export type ServerMessage =
  | { type: "welcome"; clientId: string; canEdit: boolean; joinToken?: string }
  | { type: "playlists"; playlists: PlaylistSummary[] }
  | { type: "playlist"; playlist: PlaylistDetail }
  | { type: "playlistGone"; playlistId: number }
  | ({ type: "reply"; id: number } & ({ ok: true; data?: unknown } | { ok: false; error: string }))
  | { type: "joinToken"; joinToken: string }
  | { type: "state"; session: SerializedSession; serverMs: number }
  | { type: "presence"; members: PresenceMember[] }
  | { type: "pong"; t0: number; serverMs: number };
