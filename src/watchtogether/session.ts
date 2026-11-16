import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";

export interface Track {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  /** Where this queue entry starts playing (a link's ?t=); dropped once it plays. */
  startSec?: number;
  /** Who queued it (always someone in Discord: browsers can't add tracks). */
  addedBy?: Person;
  /** The guild playlist it was queued from, as named then. */
  fromPlaylist?: { id: number; name: string };
}

/** A Discord member: their user id and the display name they had then. */
export interface Person {
  userId: string;
  name: string;
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
  /** Tracks removed from the queue lately, so a browser can undo a removal. Oldest first. */
  recentlyRemoved: RemovedTrack[];
}

/** Something that happened to a session, for the Discord action log. `by` is the
 * Discord / join-link display name; absent for anonymous browsers and automatic events. */
export type LastAction = { by?: string } & (
  | { kind: "play" | "pause" }
  | { kind: "skip"; title: string }
  | { kind: "start"; title: string }
  | { kind: "autoSkip"; title: string }
  | { kind: "finished" }
  | { kind: "enqueue"; /** Track title, or the playlist name ("" if unnamed) when count > 1. */ title: string; count: number; /** 1-based queue slot; absent when it started right away. */ position?: number; /** Queued at the front with /playnext. */ next?: true; /** Tracks the source had, when some didn't make it. */ of?: number; /** Why: "2 not found on YouTube". */ dropped?: string; /** Starts here (a link's ?t=). */ fromSec?: number; /** The same video is already playing or at this 1-based slot. */ alsoAt?: number | "now"; /** How many of a playlist's tracks were already playing or queued. */ alreadyQueued?: number }
  | { kind: "remove" | "restore"; title: string }
  | { kind: "reorder"; title: string; to: number }
  | { kind: "seek"; title: string; toSec: number }
  | { kind: "clear" | "shuffle"; count: number }
  | { kind: "autoplay"; enabled: boolean }
  | { kind: "playlistDelete"; name: string; count: number }
);

export interface RemovedTrack {
  track: Track;
  index: number;
  removedAtMs: number;
}

export type SerializedSession = Omit<Session, "advanceTimer" | "clients" | "errorTally" | "recentlyRemoved">;

/** `id` is a saved room's id when restoring one; new rooms get a random, unguessable id. */
export function createSession(guildId: string, id = randomBytes(9).toString("base64url")): Session {
  return {
    id,
    guildId,
    epoch: 0,
    queue: [],
    history: [],
    autoplay: true,
    clients: new Set(),
    errorTally: new Map(),
    recentlyRemoved: [],
  };
}

export function serializeForClient(session: Session): SerializedSession {
  const { advanceTimer: _t, clients: _c, errorTally: _e, recentlyRemoved: _r, ...rest } = session;
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

/** `silent` actions are reported by whoever caused them (a slash command's own reply). */
type ActionListener = (session: Session, action: LastAction, silent: boolean) => void;
const actionListeners = new Set<ActionListener>();

export function onAction(fn: ActionListener): () => void {
  actionListeners.add(fn);
  return () => actionListeners.delete(fn);
}

export function emitAction(session: Session, action: LastAction, silent = false): void {
  for (const fn of actionListeners) fn(session, action, silent);
}

/** How a track stopped being the current one. */
export type TrackEnd =
  | { how: "finished" }
  | { how: "skipped"; /** Discord user id, when a named person skipped. */ byUserId?: string }
  | { how: "autoSkipped" };

/**
 * The current track changed: `ended` was retired (absent when nothing was
 * playing), `started` began (absent when playback stopped). Fires before the
 * session change that follows it.
 */
type TrackListener = (session: Session, ended: { track: CurrentTrack; end: TrackEnd } | undefined, started: CurrentTrack | undefined) => void;
const trackListeners = new Set<TrackListener>();

export function onTrackChange(fn: TrackListener): () => void {
  trackListeners.add(fn);
  return () => trackListeners.delete(fn);
}

export function emitTrackChange(
  session: Session,
  ended: { track: CurrentTrack; end: TrackEnd } | undefined,
  started: CurrentTrack | undefined,
): void {
  for (const fn of trackListeners) fn(session, ended, started);
}
