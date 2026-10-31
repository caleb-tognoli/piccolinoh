import { describe, expect, it } from "vitest";
import { createSession, onSessionChange } from "../src/watchtogether/session.js";
import { advance, derivePosition, scheduleAdvance } from "../src/watchtogether/timeline.js";
import { track } from "./helpers.js";

describe("derivePosition", () => {
  it("returns 0 when there is no current track", () => {
    expect(derivePosition(createSession("g"))).toBe(0);
  });

  it("returns pausedAtPositionSec when paused", () => {
    const session = createSession("g");
    session.current = { ...track("v", 100), startedAtServerMs: Date.now(), pausedAtPositionSec: 12.5 };
    expect(derivePosition(session, Date.now() + 5_000)).toBe(12.5);
  });

  it("returns elapsed seconds since startedAtServerMs when playing", () => {
    const start = 1_000_000;
    const session = createSession("g");
    session.current = { ...track("v", 100), startedAtServerMs: start };
    expect(derivePosition(session, start)).toBe(0);
    expect(derivePosition(session, start + 30_000)).toBe(30);
  });
});

describe("advance", () => {
  it("promotes queue head to current, retires current to history, bumps epoch", () => {
    const session = createSession("g");
    session.current = { ...track("a"), startedAtServerMs: Date.now(), pausedAtPositionSec: 3 };
    session.queue.push(track("b"));
    advance(session);
    expect(session.current?.videoId).toBe("b");
    expect(session.current?.pausedAtPositionSec).toBeUndefined();
    expect(session.history).toEqual([track("a")]);
    expect(session.epoch).toBe(1);
  });

  it("clears current when the queue is empty", () => {
    const session = createSession("g");
    session.current = { ...track("a"), startedAtServerMs: Date.now() };
    advance(session);
    expect(session.current).toBeUndefined();
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
  });

  it("with startNext=false retires current and leaves the queue", () => {
    const session = createSession("g");
    session.current = { ...track("a"), startedAtServerMs: Date.now() };
    session.queue.push(track("b"));
    advance(session, false);
    expect(session.current).toBeUndefined();
    expect(session.queue.map((q) => q.videoId)).toEqual(["b"]);
  });
});

describe("scheduleAdvance", () => {
  it("does not install a timer when there is no current track or it is paused", () => {
    const session = createSession("g");
    scheduleAdvance(session);
    expect(session.advanceTimer).toBeUndefined();
    session.current = { ...track("v"), startedAtServerMs: Date.now(), pausedAtPositionSec: 3 };
    scheduleAdvance(session);
    expect(session.advanceTimer).toBeUndefined();
  });

  it("advances and notifies when the track ends", async () => {
    const session = createSession("g");
    session.current = { ...track("a", 0.05), startedAtServerMs: Date.now() };
    session.queue.push(track("b", 100));
    const changed = new Promise<void>((resolve) => {
      const off = onSessionChange((s) => {
        if (s !== session) return;
        off();
        resolve();
      });
    });
    scheduleAdvance(session);
    await changed;
    expect(session.current?.videoId).toBe("b");
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
    clearTimeout(session.advanceTimer);
  });

  it("stops after the track when autoplay is off", async () => {
    const session = createSession("g");
    session.autoplay = false;
    session.current = { ...track("a", 0.05), startedAtServerMs: Date.now() };
    session.queue.push(track("b"));
    const changed = new Promise<void>((resolve) => {
      const off = onSessionChange((s) => {
        if (s !== session) return;
        off();
        resolve();
      });
    });
    scheduleAdvance(session);
    await changed;
    expect(session.current).toBeUndefined();
    expect(session.queue.map((q) => q.videoId)).toEqual(["b"]);
  });
});
