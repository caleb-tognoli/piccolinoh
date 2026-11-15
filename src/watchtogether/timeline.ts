import { emitAction, notifySessionChange, type Session } from "./session.js";

/** Recently played tracks kept per session; the whole session is broadcast on every change. */
export const HISTORY_CAP = 200;

export function derivePosition(session: Session, serverNowMs = Date.now()): number {
  if (!session.current) return 0;
  if (session.current.pausedAtPositionSec != null) return session.current.pausedAtPositionSec;
  return (serverNowMs - session.current.startedAtServerMs) / 1000;
}

/** Retires the current track to history and starts the queue head (unless `startNext` is false). */
export function advance(session: Session, startNext = true): void {
  if (session.current) {
    const { startedAtServerMs: _s, pausedAtPositionSec: _p, startSec: _o, ...track } = session.current;
    session.history.push(track);
    if (session.history.length > HISTORY_CAP) session.history.splice(0, session.history.length - HISTORY_CAP);
  }
  const next = startNext ? session.queue.shift() : undefined;
  if (next) {
    // A link's timestamp applies to this entry only; replays start from the top.
    const { startSec = 0, ...track } = next;
    session.current = { ...track, startedAtServerMs: Date.now() - startSec * 1000 };
  } else {
    session.current = undefined;
  }
  session.errorTally.clear();
  session.epoch += 1;
}

/** (Re)arms the timer that advances the session when the current track ends. */
export function scheduleAdvance(session: Session): void {
  clearTimeout(session.advanceTimer);
  session.advanceTimer = undefined;
  if (!session.current || session.current.pausedAtPositionSec != null) return;

  const remainingMs = Math.max(0, (session.current.durationSec - derivePosition(session)) * 1000);
  session.advanceTimer = setTimeout(() => {
    session.advanceTimer = undefined;
    const wasPlaying = !!session.current;
    advance(session, session.autoplay);
    scheduleAdvance(session);
    notifySessionChange(session);
    if (wasPlaying && !session.current && session.queue.length === 0) emitAction(session, { kind: "finished" });
  }, remainingMs);
}
