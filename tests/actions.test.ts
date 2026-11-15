import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyControl, handlePlaybackError, setAutoplay } from "../src/watchtogether/control.js";
import { createSession, type LastAction, onAction, type Session } from "../src/watchtogether/session.js";
import { track } from "./helpers.js";

let session: Session;
let events: { action: LastAction; silent: boolean }[];
let unsubscribe: () => void;

beforeEach(() => {
  session = createSession("g");
  events = [];
  unsubscribe = onAction((s, action, silent) => {
    if (s === session) events.push({ action, silent });
  });
});

afterEach(() => {
  unsubscribe();
  clearTimeout(session.advanceTimer);
  vi.useRealTimers();
});

const enqueue = (...ids: string[]) =>
  applyControl(session, { kind: "enqueue", tracks: ids.map((id) => track(id)) }, { by: "Caleb" });

describe("actions", () => {
  it("reports who queued a track and where it landed", () => {
    expect(enqueue("a")).toEqual({ kind: "enqueue", title: "title a", count: 1, by: "Caleb" });
    expect(enqueue("b")).toEqual({ kind: "enqueue", title: "title b", count: 1, position: 1, by: "Caleb" });
    expect(events.map((e) => e.action.kind)).toEqual(["enqueue", "enqueue"]);
  });

  it("passes silent through to listeners", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, { silent: true });
    applyControl(session, { kind: "pause" });
    expect(events.map((e) => e.silent)).toEqual([true, false]);
  });

  it("names a playlist enqueue by its label, or leaves it unnamed", () => {
    expect(applyControl(session, { kind: "enqueue", tracks: [track("a"), track("b")] }, { label: "Mix" })).toEqual({
      kind: "enqueue",
      title: "Mix",
      count: 2,
    });
    expect(applyControl(session, { kind: "enqueue", tracks: [track("c"), track("d")] })).toMatchObject({
      title: "",
      count: 2,
      position: 2,
    });
  });

  it("reports the skipped track, and 'start' when skipping from a stopped state", () => {
    enqueue("a", "b");
    expect(applyControl(session, { kind: "skip" }, { by: "Bob" })).toEqual({ kind: "skip", title: "title a", by: "Bob" });

    // Autoplay stopped after a track: nothing current, queue waiting.
    session.current = undefined;
    session.queue = [track("c")];
    expect(applyControl(session, { kind: "skip" })).toEqual({ kind: "start", title: "title c" });
  });

  it("flags a track that's already playing or queued, but still adds it", () => {
    enqueue("a", "b", "c");
    expect(enqueue("a")).toMatchObject({ alsoAt: "now", position: 3 });
    expect(enqueue("c")).toMatchObject({ alsoAt: 2, position: 4 });
    expect(
      applyControl(session, { kind: "enqueue", tracks: [track("b")], next: true }, { by: "Caleb" }),
    ).toMatchObject({ alsoAt: 2 }); // b moved from #1 to #2 when the new copy went first
    expect(session.queue.map((t) => t.videoId)).toEqual(["b", "b", "c", "a", "c"]);
    expect(enqueue("x", "b", "y", "a")).toMatchObject({ count: 4, alreadyQueued: 2 });
    expect(enqueue("z")).not.toHaveProperty("alsoAt");
    expect(applyControl(session, { kind: "enqueue", tracks: [track("a")] }, { repeat: true })).not.toHaveProperty("alsoAt");
  });

  it("no-ops report nothing", () => {
    expect(applyControl(session, { kind: "skip" })).toBeUndefined();
    enqueue("a");
    events = [];
    expect(applyControl(session, { kind: "play" })).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("reports seeks with where they landed", () => {
    enqueue("a");
    expect(applyControl(session, { kind: "seek", toSec: 3 }, { by: "Bob" })).toEqual({
      kind: "seek",
      title: "title a",
      toSec: 3,
      by: "Bob",
    });
  });

  it("reports reorder target as a 1-based position", () => {
    enqueue("a", "b", "c", "d");
    expect(applyControl(session, { kind: "reorder", from: 2, to: 0 })).toEqual({
      kind: "reorder",
      title: "title d",
      to: 1,
    });
  });

  it("reports clear count and autoplay changes", () => {
    enqueue("a", "b", "c");
    expect(applyControl(session, { kind: "clear" }, { by: "Bob" })).toEqual({ kind: "clear", count: 2, by: "Bob" });
    expect(setAutoplay(session, false, { by: "Bob" })).toEqual({ kind: "autoplay", enabled: false, by: "Bob" });
    expect(setAutoplay(session, false)).toBeUndefined();
  });

  it("normal track changes report nothing; running out reports 'finished' once", () => {
    vi.useFakeTimers();
    enqueue("a", "b");
    events = [];
    vi.advanceTimersByTime(10_001);
    expect(session.current?.videoId).toBe("b");
    expect(events).toEqual([]);
    vi.advanceTimersByTime(10_001);
    expect(session.current).toBeUndefined();
    expect(events).toEqual([{ action: { kind: "finished" }, silent: false }]);
  });

  it("autoplay stopping with a queue waiting isn't 'finished'", () => {
    vi.useFakeTimers();
    enqueue("a", "b");
    setAutoplay(session, false);
    events = [];
    vi.advanceTimersByTime(10_001);
    expect(session.current).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("auto-skips report an autoSkip", () => {
    enqueue("a", "b");
    events = [];
    session.clients.add({} as never);
    handlePlaybackError(session, "c1", "a", 150);
    expect(events).toEqual([{ action: { kind: "autoSkip", title: "title a" }, silent: false }]);
  });
});
