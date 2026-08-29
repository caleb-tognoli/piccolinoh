import { describe, expect, it } from "vitest";
import { createSession } from "../src/watchtogether/session.js";
import { advance, derivePosition, scheduleAdvance } from "../src/watchtogether/timeline.js";

describe("derivePosition", () => {
  it("returns 0 when there is no current track", () => {
    const session = createSession("g");
    expect(derivePosition(session, Date.now())).toBe(0);
  });

  it("returns pausedAtPositionSec when paused", () => {
    const session = createSession("g");
    session.current = {
      videoId: "v",
      durationSec: 100,
      startedAtServerMs: Date.now(),
      pausedAtPositionSec: 12.5,
      requestedBy: "u",
    };
    expect(derivePosition(session, Date.now() + 5_000)).toBe(12.5);
  });

  it("returns elapsed seconds since startedAtServerMs when playing", () => {
    const start = 1_000_000;
    const session = createSession("g");
    session.current = {
      videoId: "v",
      durationSec: 100,
      startedAtServerMs: start,
      requestedBy: "u",
    };
    expect(derivePosition(session, start)).toBe(0);
    expect(derivePosition(session, start + 30_000)).toBe(30);
  });
});

describe("advance", () => {
  it("promotes queue head to current and bumps epoch", () => {
    const session = createSession("g");
    session.queue.push({ videoId: "a", durationSec: 10, requestedBy: "u" });
    advance(session);
    expect(session.current?.videoId).toBe("a");
    expect(session.queue.length).toBe(0);
    expect(session.epoch).toBe(1);
  });

  it("moves current to history when advancing", () => {
    const session = createSession("g");
    session.current = {
      videoId: "a",
      durationSec: 10,
      startedAtServerMs: Date.now(),
      requestedBy: "u",
    };
    session.queue.push({ videoId: "b", durationSec: 20, requestedBy: "u" });
    advance(session);
    expect(session.current?.videoId).toBe("b");
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
  });

  it("clears current when queue is empty and bumps epoch", () => {
    const session = createSession("g");
    session.current = {
      videoId: "a",
      durationSec: 10,
      startedAtServerMs: Date.now(),
      requestedBy: "u",
    };
    const priorEpoch = session.epoch;
    advance(session);
    expect(session.current).toBeUndefined();
    expect(session.epoch).toBe(priorEpoch + 1);
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
  });

  it("bumps epoch monotonically across many advances", () => {
    const session = createSession("g");
    for (let i = 0; i < 5; i++) {
      session.queue.push({ videoId: `v${i}`, durationSec: 1, requestedBy: "u" });
    }
    let prior = session.epoch;
    for (let i = 0; i < 5; i++) {
      advance(session);
      expect(session.epoch).toBeGreaterThan(prior);
      prior = session.epoch;
    }
  });
});

describe("scheduleAdvance", () => {
  it("does not install a timer when there is no current track", () => {
    const session = createSession("g");
    scheduleAdvance(session, () => {});
    expect(session.advanceTimer).toBeUndefined();
  });

  it("does not install a timer when paused", () => {
    const session = createSession("g");
    session.current = {
      videoId: "v",
      durationSec: 10,
      startedAtServerMs: Date.now(),
      pausedAtPositionSec: 3,
      requestedBy: "u",
    };
    scheduleAdvance(session, () => {});
    expect(session.advanceTimer).toBeUndefined();
  });

  it("fires the callback and advances when the timer elapses", async () => {
    const session = createSession("g");
    session.current = {
      videoId: "a",
      durationSec: 0.05,
      startedAtServerMs: Date.now(),
      requestedBy: "u",
    };
    const heard = new Promise<void>((resolve) => {
      scheduleAdvance(session, () => resolve());
    });
    await heard;
    expect(session.current).toBeUndefined();
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
    expect(session.epoch).toBe(1);
  });
});
