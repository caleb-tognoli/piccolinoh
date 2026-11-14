import { logger } from "../logger.js";
import { emitAction, type LastAction, notifySessionChange, type Session, type Track } from "./session.js";
import { advance, derivePosition, scheduleAdvance } from "./timeline.js";

export type ControlAction =
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "skip" }
  | { kind: "seek"; toSec: number }
  | { kind: "enqueue"; tracks: Track[] }
  | { kind: "remove"; index: number }
  | { kind: "restore"; videoId: string }
  | { kind: "reorder"; from: number; to: number }
  | { kind: "clear" };

/** How long a removed track can be put back with "restore". */
export const RESTORE_WINDOW_MS = 30_000;
const RESTORE_KEEP = 20;

/** Call after changing what is playing or where: bumps the epoch, re-arms the end-of-track timer. */
function timelineChanged(session: Session): void {
  session.epoch += 1;
  scheduleAdvance(session);
}

export interface ControlOptions {
  /** Display name of whoever did it, for the Discord action log. */
  by?: string;
  /** The caller reports the action itself, so the action log skips it. */
  silent?: boolean;
  /** Name for a multi-track enqueue (playlist / album). */
  label?: string;
  /** Replaces the action the change would report. */
  note?: LastAction;
}

/** Applies `action`; returns what happened for the action log, or undefined for no-ops and seeks. */
export function applyControl(
  session: Session,
  action: ControlAction,
  opts: ControlOptions = {},
): LastAction | undefined {
  const { current, queue } = session;
  const by = opts.by ? { by: opts.by } : {};
  let note: LastAction | undefined;
  switch (action.kind) {
    case "play":
      if (current?.pausedAtPositionSec == null) return;
      current.startedAtServerMs = Date.now() - current.pausedAtPositionSec * 1000;
      current.pausedAtPositionSec = undefined;
      timelineChanged(session);
      note = { kind: "play", ...by };
      break;
    case "pause":
      if (!current || current.pausedAtPositionSec != null) return;
      current.pausedAtPositionSec = derivePosition(session);
      timelineChanged(session);
      note = { kind: "pause", ...by };
      break;
    case "skip":
      if (!current && queue.length === 0) return;
      // With nothing playing (autoplay stopped), skipping starts the queue head.
      note = current ? { kind: "skip", title: current.title, ...by } : { kind: "start", title: queue[0]!.title, ...by };
      advance(session);
      scheduleAdvance(session);
      break;
    case "seek": {
      if (!current) return;
      const toSec = Math.max(0, Math.min(action.toSec, current.durationSec));
      if (current.pausedAtPositionSec != null) current.pausedAtPositionSec = toSec;
      else current.startedAtServerMs = Date.now() - toSec * 1000;
      timelineChanged(session);
      break;
    }
    case "enqueue": {
      const { tracks } = action;
      if (tracks.length === 0) return;
      queue.push(...tracks);
      const startsNow = !current;
      note = {
        kind: "enqueue",
        title: tracks.length > 1 ? (opts.label ?? "") : tracks[0]!.title,
        count: tracks.length,
        ...(startsNow ? {} : { position: queue.length - tracks.length + 1 }),
        ...by,
      };
      if (startsNow) {
        advance(session);
        scheduleAdvance(session);
      }
      break;
    }
    case "remove": {
      if (action.index >= queue.length) return;
      const [track] = queue.splice(action.index, 1);
      session.recentlyRemoved.push({ track: track!, index: action.index, removedAtMs: Date.now() });
      session.recentlyRemoved.splice(0, session.recentlyRemoved.length - RESTORE_KEEP);
      note = { kind: "remove", title: track!.title, ...by };
      break;
    }
    case "restore": {
      // Only puts back what was removed lately, so browsers still can't add arbitrary videos.
      const cutoff = Date.now() - RESTORE_WINDOW_MS;
      session.recentlyRemoved = session.recentlyRemoved.filter((r) => r.removedAtMs >= cutoff);
      const at = session.recentlyRemoved.map((r) => r.track.videoId).lastIndexOf(action.videoId);
      if (at === -1) return;
      const [removed] = session.recentlyRemoved.splice(at, 1);
      queue.splice(Math.min(removed!.index, queue.length), 0, removed!.track);
      note = { kind: "restore", title: removed!.track.title, ...by };
      break;
    }
    case "reorder": {
      const { from, to } = action;
      if (from >= queue.length || to >= queue.length) return;
      const [track] = queue.splice(from, 1);
      queue.splice(to, 0, track!);
      note = { kind: "reorder", title: track!.title, to: to + 1, ...by };
      break;
    }
    case "clear":
      if (queue.length === 0) return;
      note = { kind: "clear", count: queue.length, ...by };
      queue.length = 0;
      break;
  }
  notifySessionChange(session);
  if (!note) return undefined; // seeks aren't logged
  note = opts.note ?? note;
  emitAction(session, note, opts.silent);
  return note;
}

/** Turns autoplay on or off; undefined when it already was. */
export function setAutoplay(session: Session, enabled: boolean, opts: ControlOptions = {}): LastAction | undefined {
  if (session.autoplay === enabled) return undefined;
  session.autoplay = enabled;
  const note: LastAction = { kind: "autoplay", enabled, ...(opts.by ? { by: opts.by } : {}) };
  notifySessionChange(session);
  emitAction(session, note, opts.silent);
  return note;
}

/** Skips the current video once a majority of clients report it can't be embedded. */
export function handlePlaybackError(
  session: Session,
  clientId: string,
  videoId: string,
  code: number,
): void {
  if (session.current?.videoId !== videoId) return;
  let reporters = session.errorTally.get(videoId);
  if (!reporters) {
    reporters = new Set();
    session.errorTally.set(videoId, reporters);
  }
  reporters.add(clientId);
  if (reporters.size <= session.clients.size / 2) return;
  logger.info(
    { videoId, code, votes: reporters.size, clients: session.clients.size },
    "auto-skip: majority reported embed-disabled",
  );
  applyControl(session, { kind: "skip" }, { note: { kind: "autoSkip", title: session.current.title } });
}
