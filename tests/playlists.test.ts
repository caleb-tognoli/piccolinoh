import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addedMessage, roomTracks } from "../src/bot/playlists.js";
import { deletePlaylistView, describe as describeAction, PLAYLIST_PAGE_SIZE, playlistsView, playlistView, type V2Message } from "../src/bot/views.js";
import { openDatabase } from "../src/db.js";
import { applyControl } from "../src/watchtogether/control.js";
import {
  type AddResult,
  addTracks,
  deletePlaylist,
  findPlaylist,
  getPlaylist,
  listPlaylists,
  MAX_PLAYLISTS,
  MAX_TRACKS,
  moveTrack,
  queuePlaylist,
  PLAYLIST_UNDO_MS,
  removeTrack,
  renamePlaylist,
  restoreTrack,
} from "../src/watchtogether/playlists.js";
import type { Session } from "../src/watchtogether/session.js";
import { closeStore, forgetGuild, getOrCreateSessionForGuild, openStore, resetStore } from "../src/watchtogether/store.js";
import { track } from "./helpers.js";

const alice = { by: "Alice", userId: "u1" };
const bob = { by: "Bob", userId: "u2" };

let db: DatabaseSync;
let session: Session;

function add(name: string, ids: string[], userId = "u1"): AddResult {
  const result = addTracks("g1", name, ids.map((id) => track(id)), userId);
  if (typeof result === "string") throw new Error(result);
  return result;
}

const ids = (name: string) => findPlaylist("g1", name)!.tracks.map((t) => t.videoId);

beforeEach(() => {
  resetStore();
  db = openDatabase(":memory:");
  openStore(db);
  session = getOrCreateSessionForGuild("g1");
});

afterEach(() => {
  vi.useRealTimers();
  resetStore();
  db.close();
});

describe("playlists", () => {
  it("are made on first add and keep who made them and who added each track", () => {
    const made = add("Chill", ["a", "b"]);
    expect(made).toMatchObject({ created: true, added: 2, duplicates: 0, overflow: 0 });
    const more = add("chill", ["c"], "u2");
    expect(more).toMatchObject({ created: false, added: 1 });
    expect(more.playlist).toMatchObject({ name: "Chill", createdBy: "u1" });
    expect(more.playlist.tracks.map((t) => [t.videoId, t.addedBy])).toEqual([
      ["a", "u1"],
      ["b", "u1"],
      ["c", "u2"],
    ]);
  });

  it("match names ignoring case and spacing, per guild", () => {
    add("Late  Night", ["a"]);
    expect(findPlaylist("g1", " late night ")?.name).toBe("Late Night");
    expect(findPlaylist("g2", "late night")).toBeUndefined();
    expect(addTracks("g1", "   ", [track("a")], "u1")).toBe("Give the playlist a name.");
    expect(addTracks("g1", "x".repeat(51), [track("a")], "u1")).toMatch(/at most 50/);
  });

  it("skip tracks already in them, including repeats in what's added", () => {
    add("p", ["a", "b"]);
    expect(add("p", ["b", "c", "c", "a"])).toMatchObject({ added: 1, duplicates: 3 });
    expect(ids("p")).toEqual(["a", "b", "c"]);
  });

  it("take what fits under the track limit", () => {
    add("p", Array.from({ length: MAX_TRACKS - 2 }, (_, i) => `v${i}`));
    expect(add("p", ["x", "y", "z"])).toMatchObject({ added: 2, overflow: 1 });
    expect(addTracks("g1", "p", [track("w")], "u1")).toMatch(/is full/);
  });

  it("are limited per guild", () => {
    for (let i = 0; i < MAX_PLAYLISTS; i++) add(`p${i}`, ["a"]);
    expect(addTracks("g1", "one more", [track("a")], "u1")).toMatch(/already has 100 playlists/);
    expect(add("p0", ["b"]).added).toBe(1); // existing ones still grow
  });

  it("move and remove tracks, and put a removed track back where it was for a while", () => {
    vi.useFakeTimers();
    const { id } = add("p", ["a", "b", "c", "d"]).playlist;
    expect(moveTrack(id, 0, 2, "a")?.videoId).toBe("a");
    expect(ids("p")).toEqual(["b", "c", "a", "d"]);
    expect(moveTrack(id, 0, 1, "a")).toBeUndefined(); // stale button

    expect(removeTrack(id, 1, "c")?.videoId).toBe("c");
    expect(ids("p")).toEqual(["b", "a", "d"]);
    expect(restoreTrack(id, "c")?.videoId).toBe("c");
    expect(ids("p")).toEqual(["b", "c", "a", "d"]);
    expect(restoreTrack(id, "c")).toBeUndefined(); // only once

    removeTrack(id, 0, "b");
    vi.advanceTimersByTime(PLAYLIST_UNDO_MS);
    expect(restoreTrack(id, "b")).toBeUndefined();
    expect(getPlaylist(id)!.tracks[1]?.addedBy).toBe("u1");
  });

  it("rename, refusing a name another playlist has", () => {
    const { id } = add("a", ["x"]).playlist;
    add("b", ["x"]);
    expect(renamePlaylist(id, "B")).toMatch(/already a playlist called \*\*b\*\*/);
    expect(renamePlaylist(id, "A")).toBeUndefined(); // just the case
    expect(renamePlaylist(id, "Road trip")).toBeUndefined();
    expect(listPlaylists("g1").map((p) => p.name)).toEqual(["b", "Road trip"]);
  });

  it("list with track counts and lengths", () => {
    add("p", ["a", "b"]);
    expect(listPlaylists("g1")).toEqual([{ id: expect.any(Number), name: "p", trackCount: 2, durationSec: 20 }]);
  });

  it("are deleted when the bot leaves the guild", () => {
    add("p", ["a"]);
    addTracks("g2", "q", [track("a")], "u1");
    forgetGuild("g1");
    expect(listPlaylists("g1")).toEqual([]);
    expect(listPlaylists("g2")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM playlist_tracks").get()).toEqual({ n: 1 });
  });
});

describe("queueing a playlist", () => {
  it("credits whoever queued it and marks each track with the playlist", () => {
    const { playlist } = add("Chill", ["a", "b"], "u1");
    const outcome = queuePlaylist(session, playlist, bob);
    expect(outcome).toMatchObject({ kind: "enqueue", title: "Chill", count: 2 });
    expect(describeAction(outcome as Exclude<typeof outcome, string>)).toBe("queued 2 tracks from **Chill**");
    const from = { id: playlist.id, name: "Chill" };
    expect(session.current).toMatchObject({ videoId: "a", addedBy: { userId: "u2", name: "Bob" }, fromPlaylist: from });
    expect(session.queue[0]).toMatchObject({ videoId: "b", fromPlaylist: from });
  });

  it("refuses an empty playlist", () => {
    const { id } = add("p", ["a"]).playlist;
    removeTrack(id, 0, "a");
    expect(queuePlaylist(session, getPlaylist(id)!, alice)).toBe("**p** is empty.");
  });

  it("is forgotten when a track is queued again from history", () => {
    queuePlaylist(session, add("p", ["a"]).playlist, alice);
    applyControl(session, { kind: "skip" });
    expect(session.history[0]?.fromPlaylist).toBeDefined();
    applyControl(session, { kind: "enqueue", tracks: [session.history[0]!] }, alice);
    expect(session.current?.fromPlaylist).toBeUndefined();
  });

  it("is logged with each play, and survives the playlist being deleted", () => {
    const { playlist } = add("p", ["a", "b"]);
    queuePlaylist(session, playlist, alice);
    deletePlaylist(playlist.id);
    applyControl(session, { kind: "skip" }); // b starts after its playlist is gone
    const rows = db.prepare("SELECT video_id, playlist_id FROM plays ORDER BY id").all();
    expect(rows).toEqual([
      { video_id: "a", playlist_id: null }, // set null by the delete
      { video_id: "b", playlist_id: null },
    ]);
  });

  it("keeps its playlist id in the play log", () => {
    const { playlist } = add("p", ["a"]);
    queuePlaylist(session, playlist, alice);
    expect(db.prepare("SELECT playlist_id FROM plays").get()).toEqual({ playlist_id: playlist.id });
  });

  it("keeps the badge across a restart", () => {
    const { playlist } = add("p", ["a", "b"]);
    queuePlaylist(session, playlist, alice);
    closeStore();
    openStore(db);
    const restored = getOrCreateSessionForGuild("g1");
    expect(restored.current?.fromPlaylist).toEqual({ id: playlist.id, name: "p" });
    expect(restored.queue[0]?.fromPlaylist).toEqual({ id: playlist.id, name: "p" });
  });
});

describe("saving the room", () => {
  it("takes what's playing and/or the queue, without timing", () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a"), track("b")] }, alice);
    expect(roomTracks(session, "both").map((t) => t.videoId)).toEqual(["a", "b"]);
    expect(roomTracks(session, "current")).toEqual([{ ...track("a"), addedBy: { userId: "u1", name: "Alice" } }]);
    expect(roomTracks(session, "queue").map((t) => t.videoId)).toEqual(["b"]);
  });
});

describe("replies and views", () => {
  it("say what was added and what wasn't", () => {
    expect(addedMessage(add("p", ["a", "b"]))).toBe("Made **p** with 2 tracks");
    expect(addedMessage(add("p", ["b", "c"]), "1 not found on YouTube")).toBe(
      "Added 1 track to **p** (3 now) · 1 already in it · 1 not found on YouTube",
    );
    expect(addedMessage(add("p", ["a"]))).toBe("Nothing new for **p** · 1 already in it");
  });

  /** Builds the message (running discord.js validation) and counts every component. */
  interface Node {
    components?: Node[];
    accessory?: Node;
  }
  function count(message: V2Message): number {
    let n = 0;
    const walk = (c: Node) => {
      n++;
      c.components?.forEach(walk);
      if (c.accessory) walk(c.accessory);
    };
    message.components.forEach((c) => walk(c.toJSON() as Node));
    return n;
  }

  it("fit Discord's 40-component limit with every button showing", () => {
    const { id } = add("p", Array.from({ length: 20 }, (_, i) => `v${i}`)).playlist;
    removeTrack(id, 0, "v0");
    const view = playlistView(getPlaylist(id)!, 1, "Removed **v0**", "v0");
    expect(count(view)).toBeLessThanOrEqual(40);
    const json = JSON.stringify(view.components.map((c) => c.toJSON()));
    expect(json).toContain(`playlist:${id}:undo:1:v0`);
    expect(json).toContain(`playlist:${id}:rm:1:${PLAYLIST_PAGE_SIZE}:v${PLAYLIST_PAGE_SIZE + 1}`);
    expect(count(deletePlaylistView(getPlaylist(id)!, 0))).toBeLessThan(40);
    for (let i = 0; i < 25; i++) add(`list ${i}`, ["a"]);
    expect(count(playlistsView(listPlaylists("g1"), 1))).toBeLessThanOrEqual(40);
  });

  it("describe deleting a playlist", () => {
    expect(describeAction({ kind: "playlistDelete", name: "Chill", count: 1 })).toBe("deleted playlist **Chill** (1 track)");
  });
});
