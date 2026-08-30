import type { Session } from "./session.js";

export function derivePosition(session: Session, serverNowMs: number): number {
  if (!session.current) return 0;
  if (session.current.pausedAtPositionSec != null) return session.current.pausedAtPositionSec;
  return (serverNowMs - session.current.startedAtServerMs) / 1000;
}

export function advance(session: Session): void {
  if (session.current) {
    session.history.push({
      videoId: session.current.videoId,
      durationSec: session.current.durationSec,
      requestedBy: session.current.requestedBy,
    });
  }
  const next = session.queue.shift();
  if (next) {
    session.current = {
      videoId: next.videoId,
      durationSec: next.durationSec,
      startedAtServerMs: Date.now(),
      requestedBy: next.requestedBy,
    };
  } else {
    session.current = undefined;
  }
  session.errorTally.clear();
  session.epoch += 1;
}

export function autoAdvance(session: Session): void {
  if (session.settings.autoplay) {
    advance(session);
    return;
  }
  if (!session.current) return;
  session.history.push({
    videoId: session.current.videoId,
    durationSec: session.current.durationSec,
    requestedBy: session.current.requestedBy,
  });
  session.current = undefined;
  session.errorTally.clear();
  session.epoch += 1;
}

export function scheduleAdvance(session: Session, onAdvance: (s: Session) => void): void {
  if (session.advanceTimer) {
    clearTimeout(session.advanceTimer);
    session.advanceTimer = undefined;
  }
  if (!session.current || session.current.pausedAtPositionSec != null) return;

  const now = Date.now();
  const remainingMs = Math.max(0, (session.current.durationSec - derivePosition(session, now)) * 1000);
  session.advanceTimer = setTimeout(() => {
    session.advanceTimer = undefined;
    autoAdvance(session);
    onAdvance(session);
    scheduleAdvance(session, onAdvance);
  }, remainingMs);
}
