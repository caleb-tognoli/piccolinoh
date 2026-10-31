import { notifySessionChange, type Session } from "./session.js";

export function derivePosition(session: Session, serverNowMs = Date.now()): number {
  if (!session.current) return 0;
  if (session.current.pausedAtPositionSec != null) return session.current.pausedAtPositionSec;
  return (serverNowMs - session.current.startedAtServerMs) / 1000;
}

/** Retires the current track to history and starts the queue head (unless `startNext` is false). */
export function advance(session: Session, startNext = true): void {
  if (session.current) {
    const { startedAtServerMs: _s, pausedAtPositionSec: _p, ...track } = session.current;
    session.history.push(track);
  }
  const next = startNext ? session.queue.shift() : undefined;
  session.current = next ? { ...next, startedAtServerMs: Date.now() } : undefined;
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
    advance(session, session.autoplay);
    scheduleAdvance(session);
    notifySessionChange(session);
  }, remainingMs);
}
