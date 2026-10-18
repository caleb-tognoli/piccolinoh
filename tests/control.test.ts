import { beforeEach, describe, expect, it } from "vitest";
import { applyControl, handlePlaybackError } from "../src/watchtogether/control.js";
import { createSession, type Session } from "../src/watchtogether/session.js";
import { track } from "./helpers.js";

let session: Session;

beforeEach(() => {
  session = createSession("g");
});

const enqueue = (...ids: string[]) =>
  applyControl(session, { kind: "enqueue", tracks: ids.map((id) => track(id)) });

describe("applyControl", () => {
  it("enqueue on empty starts playback and bumps epoch", () => {
    enqueue("a");
    expect(session.current?.videoId).toBe("a");
    expect(session.current?.title).toBe("title a");
    expect(session.queue).toHaveLength(0);
    expect(session.epoch).toBe(1);
  });

  it("enqueue of several tracks starts the first and queues the rest", () => {
    enqueue("a", "b", "c");
    expect(session.current?.videoId).toBe("a");
    expect(session.queue.map((q) => q.videoId)).toEqual(["b", "c"]);
  });

  it("enqueue on non-empty appends to queue and does not bump epoch", () => {
    enqueue("a");
    const priorEpoch = session.epoch;
    enqueue("b");
    expect(session.current?.videoId).toBe("a");
    expect(session.queue.map((q) => q.videoId)).toEqual(["b"]);
    expect(session.epoch).toBe(priorEpoch);
  });

  it("skip promotes queue head to current and bumps epoch", () => {
    enqueue("a", "b");
    const priorEpoch = session.epoch;
    applyControl(session, { kind: "skip" });
    expect(session.current?.videoId).toBe("b");
    expect(session.history.map((h) => h.videoId)).toEqual(["a"]);
    expect(session.epoch).toBeGreaterThan(priorEpoch);
  });

  it("pause sets pausedAtPositionSec, resume clears it, both bump epoch", () => {
    enqueue("a");
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
    applyControl(session, { kind: "enqueue", tracks: [track("a", 30)] });
    const before = session.epoch;
    applyControl(session, { kind: "seek", toSec: 100 });
    const derived = (Date.now() - (session.current?.startedAtServerMs ?? 0)) / 1000;
    expect(derived).toBeCloseTo(30, 0);
    expect(session.epoch).toBeGreaterThan(before);
  });

  it("remove out-of-range is a no-op", () => {
    enqueue("a", "b");
    applyControl(session, { kind: "remove", index: 5 });
    expect(session.queue.map((q) => q.videoId)).toEqual(["b"]);
  });

  it("reorder moves a queued track", () => {
    enqueue("a", "b", "c", "d");
    applyControl(session, { kind: "reorder", from: 0, to: 2 });
    expect(session.queue.map((q) => q.videoId)).toEqual(["c", "d", "b"]);
  });

  it("clear empties the queue and leaves current alone", () => {
    enqueue("a", "b", "c");
    const before = session.epoch;
    applyControl(session, { kind: "clear" });
    expect(session.current?.videoId).toBe("a");
    expect(session.queue).toHaveLength(0);
    expect(session.epoch).toBe(before);
  });
});

describe("handlePlaybackError", () => {
  it("skips once a majority of clients report the current video", () => {
    enqueue("a", "b");
    session.clients = new Set([{}, {}, {}] as never);
    handlePlaybackError(session, "c1", "a", 150);
    expect(session.current?.videoId).toBe("a");
    handlePlaybackError(session, "c2", "a", 150);
    expect(session.current?.videoId).toBe("b");
  });

  it("ignores reports for a video that isn't playing", () => {
    enqueue("a");
    handlePlaybackError(session, "c1", "other", 150);
    expect(session.current?.videoId).toBe("a");
    expect(session.errorTally.size).toBe(0);
  });
});
