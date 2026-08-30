import { beforeEach, describe, expect, it } from "vitest";
import { applyControl } from "../src/watchtogether/control.js";
import { createSession, type Session } from "../src/watchtogether/session.js";
import { autoAdvance } from "../src/watchtogether/timeline.js";

let session: Session;

beforeEach(() => {
  session = createSession("g");
});

describe("applyControl (extracted)", () => {
  it("enqueue on empty starts playback and bumps epoch", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 }, "u1");
    expect(session.current?.videoId).toBe("a");
    expect(session.current?.requestedBy).toBe("u1");
    expect(session.queue).toHaveLength(0);
    expect(session.epoch).toBe(1);
  });

  it("enqueue on non-empty appends to queue and does not bump epoch", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 });
    const priorEpoch = session.epoch;
    applyControl(session, { kind: "enqueue", videoId: "b", durationSec: 20 });
    expect(session.current?.videoId).toBe("a");
    expect(session.queue.map((q) => q.videoId)).toEqual(["b"]);
    expect(session.epoch).toBe(priorEpoch);
  });

  it("skip promotes queue head to current and bumps epoch", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 });
    applyControl(session, { kind: "enqueue", videoId: "b", durationSec: 20 });
    const priorEpoch = session.epoch;
    applyControl(session, { kind: "skip" });
    expect(session.current?.videoId).toBe("b");
    expect(session.epoch).toBeGreaterThan(priorEpoch);
  });

  it("pause sets pausedAtPositionSec, resume clears it, both bump epoch", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 100 });
    const before = session.epoch;
    applyControl(session, { kind: "pause" });
    expect(session.current?.pausedAtPositionSec).toBeGreaterThanOrEqual(0);
    expect(session.epoch).toBeGreaterThan(before);
    const midEpoch = session.epoch;
    applyControl(session, { kind: "play" });
    expect(session.current?.pausedAtPositionSec).toBeUndefined();
    expect(session.epoch).toBeGreaterThan(midEpoch);
  });

  it("seek clamps to [0, durationSec] and bumps epoch", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 30 });
    const before = session.epoch;
    applyControl(session, { kind: "seek", toSec: 100 });
    // Not paused: verify effective position via startedAtServerMs adjustment
    const derived = (Date.now() - (session.current?.startedAtServerMs ?? 0)) / 1000;
    expect(derived).toBeCloseTo(30, 0);
    expect(session.epoch).toBeGreaterThan(before);
  });

  it("remove out-of-range is a no-op", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 });
    applyControl(session, { kind: "enqueue", videoId: "b", durationSec: 20 });
    const before = session.epoch;
    applyControl(session, { kind: "remove", index: 5 });
    expect(session.queue.map((q) => q.videoId)).toEqual(["b"]);
    expect(session.epoch).toBe(before);
  });

  it("clear empties the queue and leaves current alone", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 });
    applyControl(session, { kind: "enqueue", videoId: "b", durationSec: 20 });
    applyControl(session, { kind: "enqueue", videoId: "c", durationSec: 30 });
    const before = session.epoch;
    applyControl(session, { kind: "clear" });
    expect(session.current?.videoId).toBe("a");
    expect(session.queue).toHaveLength(0);
    expect(session.epoch).toBe(before);
  });

  it("clear on empty queue is a no-op", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 });
    const before = session.epoch;
    applyControl(session, { kind: "clear" });
    expect(session.queue).toHaveLength(0);
    expect(session.epoch).toBe(before);
  });
});

describe("autoAdvance", () => {
  it("with autoplay on: promotes queue head to current", () => {
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 });
    applyControl(session, { kind: "enqueue", videoId: "b", durationSec: 20 });
    autoAdvance(session);
    expect(session.current?.videoId).toBe("b");
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
  });

  it("with autoplay off: retires current, leaves queue", () => {
    session.settings.autoplay = false;
    applyControl(session, { kind: "enqueue", videoId: "a", durationSec: 10 });
    applyControl(session, { kind: "enqueue", videoId: "b", durationSec: 20 });
    autoAdvance(session);
    expect(session.current).toBeUndefined();
    expect(session.queue.map((q) => q.videoId)).toEqual(["b"]);
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
  });
});
