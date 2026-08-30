import { logger } from "../logger.js";
import { sessionEmitter } from "./events.js";
import type { ControlAction } from "./protocol.js";
import type { Session } from "./session.js";
import { advance, derivePosition, scheduleAdvance } from "./timeline.js";

function emitStateChanged(session: Session): void {
  sessionEmitter.emit("stateChanged", session);
}

function emitQueueChanged(session: Session): void {
  sessionEmitter.emit("queueChanged", session);
}

export function applyControl(
  session: Session,
  action: ControlAction,
  requesterId: string = "anonymous",
): void {
  switch (action.kind) {
    case "play": {
      if (!session.current) return;
      if (session.current.pausedAtPositionSec == null) return;
      const now = Date.now();
      session.current.startedAtServerMs = now - session.current.pausedAtPositionSec * 1000;
      session.current.pausedAtPositionSec = undefined;
      session.epoch += 1;
      scheduleAdvance(session, emitStateChanged);
      emitStateChanged(session);
      return;
    }
    case "pause": {
      if (!session.current || session.current.pausedAtPositionSec != null) return;
      session.current.pausedAtPositionSec = derivePosition(session, Date.now());
      session.epoch += 1;
      scheduleAdvance(session, emitStateChanged);
      emitStateChanged(session);
      return;
    }
    case "skip": {
      advance(session);
      scheduleAdvance(session, emitStateChanged);
      emitStateChanged(session);
      return;
    }
    case "seek": {
      if (!session.current) return;
      const clamped = Math.max(0, Math.min(action.toSec, session.current.durationSec));
      if (session.current.pausedAtPositionSec != null) {
        session.current.pausedAtPositionSec = clamped;
      } else {
        session.current.startedAtServerMs = Date.now() - clamped * 1000;
      }
      session.epoch += 1;
      scheduleAdvance(session, emitStateChanged);
      emitStateChanged(session);
      return;
    }
    case "enqueue": {
      const item = {
        videoId: action.videoId,
        durationSec: action.durationSec,
        requestedBy: requesterId,
      };
      if (!session.current) {
        session.current = { ...item, startedAtServerMs: Date.now() };
        session.epoch += 1;
        scheduleAdvance(session, emitStateChanged);
        emitStateChanged(session);
      } else {
        session.queue.push(item);
        emitQueueChanged(session);
      }
      return;
    }
    case "remove": {
      if (action.index >= session.queue.length) return;
      session.queue.splice(action.index, 1);
      emitQueueChanged(session);
      return;
    }
    case "reorder": {
      const { from, to } = action;
      if (from >= session.queue.length || to >= session.queue.length) return;
      const [item] = session.queue.splice(from, 1);
      if (!item) return;
      session.queue.splice(to, 0, item);
      emitQueueChanged(session);
      return;
    }
    case "clear": {
      if (session.queue.length === 0) return;
      session.queue = [];
      emitQueueChanged(session);
      return;
    }
  }
}


export function handlePlaybackError(
  session: Session,
  clientId: string,
  videoId: string,
  code: number,
): void {
  if (!session.current || session.current.videoId !== videoId) return;
  let set = session.errorTally.get(videoId);
  if (!set) {
    set = new Set();
    session.errorTally.set(videoId, set);
  }
  set.add(clientId);
  const half = session.clients.size / 2;
  if (set.size > half) {
    logger.info(
      { videoId, code, votes: set.size, clients: session.clients.size },
      "auto-skip: majority reported embed-disabled",
    );
    advance(session);
    scheduleAdvance(session, emitStateChanged);
    emitStateChanged(session);
  }
}
