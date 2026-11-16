import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db.js";
import { applyControl, setAutoplay } from "../src/watchtogether/control.js";
import {
  closeStore,
  forgetGuild,
  getOrCreateSessionForGuild,
  getSession,
  openStore,
  resetStore,
  SAVE_DELAY_MS,
} from "../src/watchtogether/store.js";
import { derivePosition } from "../src/watchtogether/timeline.js";
import { track } from "./helpers.js";

beforeEach(() => {
  resetStore();
});

describe("getOrCreateSessionForGuild", () => {
  it("creates a fresh session when none exists for the guild", () => {
    const session = getOrCreateSessionForGuild("g1");
    expect(session.guildId).toBe("g1");
    expect(getSession(session.id)).toBe(session);
  });

  it("returns the same session on subsequent calls for the same guild", () => {
    const first = getOrCreateSessionForGuild("g1");
    const second = getOrCreateSessionForGuild("g1");
    expect(second).toBe(first);
    expect(second.id).toBe(first.id);
  });

  it("creates independent sessions per guild", () => {
    const a = getOrCreateSessionForGuild("g1");
    const b = getOrCreateSessionForGuild("g2");
    expect(a.id).not.toBe(b.id);
    expect(a.guildId).toBe("g1");
    expect(b.guildId).toBe("g2");
  });
});

describe("persistence", () => {
  let db: DatabaseSync;

  /** Saves everything and loads it back, as a restart would. */
  function restart(): void {
    closeStore();
    openStore(db);
  }

  function savedState(roomId: string): unknown {
    const row = db.prepare("SELECT state FROM room_state WHERE room_id = ?").get(roomId) as { state: string } | undefined;
    return row && JSON.parse(row.state);
  }

  beforeEach(() => {
    db = openDatabase(":memory:");
    openStore(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetStore();
    db.close();
  });

  it("keeps a guild's room id across restarts", () => {
    const { id } = getOrCreateSessionForGuild("g1");
    restart();
    const session = getOrCreateSessionForGuild("g1");
    expect(session.id).toBe(id);
    expect(getSession(id)).toBe(session);
  });

  it("restores the queue, history and autoplay, paused where playback was", () => {
    vi.useFakeTimers();
    const before = getOrCreateSessionForGuild("g1");
    applyControl(before, { kind: "enqueue", tracks: [track("a", 100), track("b"), track("c")] });
    applyControl(before, { kind: "skip" }); // a → history, b plays
    setAutoplay(before, false);
    vi.advanceTimersByTime(4_000);
    const epoch = before.epoch;

    restart();

    const after = getOrCreateSessionForGuild("g1");
    expect(after).not.toBe(before);
    expect(after.history.map((t) => t.videoId)).toEqual(["a"]);
    expect(after.current?.videoId).toBe("b");
    expect(after.current?.pausedAtPositionSec).toBeCloseTo(4, 1);
    expect(derivePosition(after)).toBeCloseTo(4, 1);
    expect(after.queue.map((t) => t.videoId)).toEqual(["c"]);
    expect(after.autoplay).toBe(false);
    expect(after.epoch).toBe(epoch + 1);
    expect(after.advanceTimer).toBeUndefined();
  });

  it("writes changes shortly after they happen, once per burst", () => {
    vi.useFakeTimers();
    const session = getOrCreateSessionForGuild("g1");
    applyControl(session, { kind: "enqueue", tracks: [track("a")] });
    applyControl(session, { kind: "enqueue", tracks: [track("b")] });
    expect(savedState(session.id)).toBeUndefined();

    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(savedState(session.id)).toMatchObject({ current: { videoId: "a" }, queue: [{ videoId: "b" }] });
  });

  it("starts a room empty when its saved state is unreadable", () => {
    const { id } = getOrCreateSessionForGuild("g1");
    restart();
    db.prepare("UPDATE room_state SET state = ? WHERE room_id = ?").run('{"queue": 5}', id);
    resetStore();
    openStore(db);

    const session = getOrCreateSessionForGuild("g1");
    expect(session.id).toBe(id);
    expect(session.queue).toEqual([]);
  });

  it("deletes a guild's room when the bot leaves it", () => {
    const { id } = getOrCreateSessionForGuild("g1");
    getOrCreateSessionForGuild("g2");
    forgetGuild("g1");
    expect(getSession(id)).toBeUndefined();

    restart();
    expect(getOrCreateSessionForGuild("g1").id).not.toBe(id);
    const rooms = db.prepare("SELECT guild_id FROM rooms ORDER BY guild_id").all() as { guild_id: string }[];
    expect(rooms.map((r) => r.guild_id)).toEqual(["g1", "g2"]);
  });
});

describe("openDatabase", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "piccolinoh-db-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates its folder and keeps rooms in the file", () => {
    const file = path.join(dir, "nested", "piccolinoh.db");
    let db = openDatabase(file);
    openStore(db);
    const { id } = getOrCreateSessionForGuild("g1");
    closeStore();
    db.close();

    db = openDatabase(file);
    openStore(db);
    expect(getOrCreateSessionForGuild("g1").id).toBe(id);
    resetStore();
    db.close();
  });

  it("refuses a database from a newer build", () => {
    const file = path.join(dir, "piccolinoh.db");
    const db = openDatabase(file);
    db.exec("PRAGMA user_version = 99");
    db.close();
    expect(() => openDatabase(file)).toThrow(/newer than this build/);
  });
});
