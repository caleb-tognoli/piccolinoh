import { logger } from "../logger.js";
import { notifySessionChange, type Session, type Track } from "./session.js";
import { advance, derivePosition, scheduleAdvance } from "./timeline.js";

export type ControlAction =
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "skip" }
  | { kind: "seek"; toSec: number }
  | { kind: "enqueue"; tracks: Track[] }
  | { kind: "remove"; index: number }
  | { kind: "reorder"; from: number; to: number }
  | { kind: "clear" };

/** Call after changing what is playing or where: bumps the epoch, re-arms the end-of-track timer. */
function timelineChanged(session: Session): void {
  session.epoch += 1;
  scheduleAdvance(session);
}

export function applyControl(session: Session, action: ControlAction): void {
  const { current, queue } = session;
  switch (action.kind) {
    case "play":
      if (current?.pausedAtPositionSec == null) return;
      current.startedAtServerMs = Date.now() - current.pausedAtPositionSec * 1000;
      current.pausedAtPositionSec = undefined;
      timelineChanged(session);
      break;
    case "pause":
      if (!current || current.pausedAtPositionSec != null) return;
      current.pausedAtPositionSec = derivePosition(session);
      timelineChanged(session);
      break;
    case "skip":
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
      if (action.tracks.length === 0) return;
      queue.push(...action.tracks);
      if (!current) {
        advance(session);
        scheduleAdvance(session);
      }
      break;
    }
    case "remove":
      if (action.index >= queue.length) return;
      queue.splice(action.index, 1);
      break;
    case "reorder": {
      const { from, to } = action;
      if (from >= queue.length || to >= queue.length) return;
      queue.splice(to, 0, ...queue.splice(from, 1));
      break;
    }
    case "clear":
      if (queue.length === 0) return;
      queue.length = 0;
      break;
  }
  notifySessionChange(session);
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
  applyControl(session, { kind: "skip" });
}
