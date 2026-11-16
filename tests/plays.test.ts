import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db.js";
import { applyControl, handlePlaybackError } from "../src/watchtogether/control.js";
import { recordListener, setStatsOptOut, setViewerSource } from "../src/watchtogether/plays.js";
import type { Session } from "../src/watchtogether/session.js";
import { closeStore, forgetGuild, getOrCreateSessionForGuild, openStore, resetStore } from "../src/watchtogether/store.js";
import { track } from "./helpers.js";

const alice = { by: "Alice", userId: "u1" };
const bob = { by: "Bob", userId: "u2" };

interface PlayRow {
  id: number;
  video_id: string;
  added_by: string | null;
  played_sec: number;
  outcome: string | null;
  ended_by: string | null;
  ended_at: number | null;
}

let db: DatabaseSync;
let session: Session;

function plays(): PlayRow[] {
  return db.prepare("SELECT * FROM plays ORDER BY id").all() as unknown as PlayRow[];
}

function listeners(playId: number): string[] {
  const rows = db.prepare("SELECT user_id FROM play_listeners WHERE play_id = ? ORDER BY user_id").all(playId);
  return (rows as { user_id: string }[]).map((r) => r.user_id);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  db = openDatabase(":memory:");
  openStore(db);
  session = getOrCreateSessionForGuild("g1");
  setViewerSource(() => []);
});

afterEach(() => {
  resetStore();
  db.close();
  vi.useRealTimers();
});

describe("play log", () => {
  it("records a finished play with who added it, not counting paused time", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a", 10)] }, alice);
    vi.advanceTimersByTime(3_000);
    applyControl(session, { kind: "pause" });
    vi.advanceTimersByTime(5_000);
    applyControl(session, { kind: "play" });
    vi.advanceTimersByTime(7_000); // the track ends

    expect(session.current).toBeUndefined();
    const [play] = plays();
    expect(play).toMatchObject({ video_id: "a", added_by: "u1", outcome: "finished", ended_by: null });
    expect(play!.played_sec).toBeCloseTo(10, 1);
  });

  it("records who skipped, and auto-skips apart from skips", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a"), track("b"), track("c")] }, alice);
    vi.advanceTimersByTime(2_000);
    applyControl(session, { kind: "skip" }, bob);
    handlePlaybackError(session, "browser-1", "b", 150);

    expect(plays().map(({ video_id, outcome, ended_by }) => ({ video_id, outcome, ended_by }))).toEqual([
      { video_id: "a", outcome: "skipped", ended_by: "u2" },
      { video_id: "b", outcome: "autoSkipped", ended_by: null },
      { video_id: "c", outcome: null, ended_by: null },
    ]);
    expect(plays()[0]!.played_sec).toBeCloseTo(2, 1);
  });

  it("counts everyone in the room as a listener, including people who join mid-track", () => {
    setViewerSource(() => ["u2"]);
    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, alice);
    recordListener(session, "u3");
    recordListener(session, "u3");

    expect(listeners(plays()[0]!.id)).toEqual(["u2", "u3"]);
  });

  it("re-adding from history credits whoever re-added it", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, alice);
    applyControl(session, { kind: "skip" });
    applyControl(session, { kind: "enqueue", tracks: [session.history[0]!] }, bob);

    expect(session.current?.addedBy).toEqual({ userId: "u2", name: "Bob" });
    expect(plays().map((p) => p.added_by)).toEqual(["u1", "u2"]);
  });

  it("leaves out and erases people who opt out, until they opt back in", () => {
    setViewerSource(() => ["u1"]);
    applyControl(session, { kind: "enqueue", tracks: [track("a"), track("b"), track("c")] }, alice);
    applyControl(session, { kind: "skip" }, alice);

    setStatsOptOut("g1", "u1", true);
    expect(plays()[0]).toMatchObject({ added_by: null, ended_by: null });
    expect(listeners(plays()[0]!.id)).toEqual([]);
    applyControl(session, { kind: "skip" }, alice); // b ends, c starts
    expect(plays().slice(1).map((p) => [p.added_by, p.ended_by])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(listeners(plays()[2]!.id)).toEqual([]);
    // Opting back in counts them from then on.
    setStatsOptOut("g1", "u1", false);
    recordListener(session, "u1");
    expect(listeners(plays()[2]!.id)).toEqual(["u1"]);
  });

  it("keeps counting the same play across a restart", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a", 10)] }, alice);
    vi.advanceTimersByTime(4_000);
    closeStore();
    vi.advanceTimersByTime(60_000); // downtime doesn't count
    openStore(db);

    const restored = getOrCreateSessionForGuild("g1");
    applyControl(restored, { kind: "play" });
    vi.advanceTimersByTime(6_000);

    expect(plays()).toHaveLength(1);
    expect(plays()[0]).toMatchObject({ outcome: "finished", added_by: "u1" });
    expect(plays()[0]!.played_sec).toBeCloseTo(10, 1);
  });

  it("closes plays a crashed run left open", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a", 100)] }, alice);
    resetStore(); // no save: like a crash before the state was written
    openStore(db);

    expect(plays()[0]).toMatchObject({ outcome: "interrupted" });
    expect(plays()[0]!.ended_at).not.toBeNull();
  });

  it("deletes a server's plays when the bot leaves it", () => {
    setViewerSource(() => ["u2"]);
    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, alice);
    setStatsOptOut("g1", "u3", true);
    forgetGuild("g1");

    expect(plays()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM play_listeners").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM stats_optouts").get()).toEqual({ n: 0 });
  });

  it("doesn't credit anyone when the adder isn't named", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a")] });
    expect(session.current?.addedBy).toBeUndefined();
    expect(plays()[0]!.added_by).toBeNull();
  });
});
