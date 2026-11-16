import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { openDatabase } from "../src/db.js";
import { signJoinToken } from "../src/joinToken.js";
import { applyControl } from "../src/watchtogether/control.js";
import { LOOKUPS_PER_MINUTE, type LookupService, resetLookupLimits, setLookupService } from "../src/watchtogether/lookups.js";
import { addTracks, findPlaylist, getPlaylist } from "../src/watchtogether/playlists.js";
import { startServer } from "../src/watchtogether/server.js";
import { onAction, type LastAction, type Session } from "../src/watchtogether/session.js";
import { getOrCreateSessionForGuild, openStore, resetStore } from "../src/watchtogether/store.js";
import { track } from "./helpers.js";

let app: FastifyInstance;
let port: number;
let db: DatabaseSync;
let session: Session;

beforeEach(async () => {
  resetStore();
  db = openDatabase(":memory:");
  openStore(db);
  session = getOrCreateSessionForGuild("g1");
  app = await startServer(0);
  port = (app.server.address() as AddressInfo).port;
});

afterEach(async () => {
  setLookupService(undefined);
  resetLookupLimits();
  resetStore();
  db.close();
  await app.close();
});

interface Client {
  ws: WebSocket;
  welcome: any;
  playlists: any;
  /** Sends a request and waits for its reply. */
  ask(request: object): Promise<any>;
  /** Waits for the next message matching `predicate`. */
  next(predicate: (msg: any) => boolean): Promise<any>;
}

let requestId = 1;

async function join(as?: { name: string; userId?: string }): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const seen: any[] = [];
  const waiters: { predicate: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  ws.on("message", (raw: Buffer) => {
    const msg = JSON.parse(raw.toString("utf8"));
    const i = waiters.findIndex((w) => w.predicate(msg));
    if (i === -1) seen.push(msg);
    else waiters.splice(i, 1)[0]!.resolve(msg);
  });
  const next = (predicate: (m: any) => boolean) =>
    new Promise<any>((resolve, reject) => {
      const i = seen.findIndex(predicate);
      if (i !== -1) return resolve(seen.splice(i, 1)[0]);
      const timer = setTimeout(() => reject(new Error("timeout waiting for message")), 3_000);
      waiters.push({ predicate, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const token = as
    ? signJoinToken({ sid: session.id, gid: session.guildId, dn: as.name, ...(as.userId ? { uid: as.userId } : {}) })
    : undefined;
  ws.send(JSON.stringify({ type: "hello", sessionId: session.id, ...(token ? { joinToken: token } : {}) }));
  const welcome = await next((m) => m.type === "welcome");
  const playlists = await next((m) => m.type === "playlists");
  return {
    ws,
    welcome,
    playlists,
    next,
    ask(request) {
      const id = requestId++;
      ws.send(JSON.stringify({ type: "request", id, request }));
      return next((m) => m.type === "reply" && m.id === id);
    },
  };
}

const alice = { name: "Alice", userId: "u1" };

describe("playlists on the site", () => {
  it("sends every browser the list, and says who may edit", async () => {
    addTracks("g1", "Chill", [track("a"), track("b")], "u9");
    const [named, guest, oldLink] = await Promise.all([join(alice), join(), join({ name: "Old" })]);
    expect(named.welcome.canEdit).toBe(true);
    expect(guest.welcome.canEdit).toBe(false);
    expect(oldLink.welcome.canEdit).toBe(false); // a link without a Discord id
    expect(guest.playlists.playlists).toEqual([{ id: expect.any(Number), name: "Chill", trackCount: 2, durationSec: 20 }]);
  });

  it("lets guests look but not change anything", async () => {
    const { playlist } = addTracks("g1", "Chill", [track("a")], "u9") as Exclude<ReturnType<typeof addTracks>, string>;
    const guest = await join();
    const opened = await guest.ask({ kind: "openPlaylist", playlistId: playlist.id });
    expect(opened).toMatchObject({ ok: true, data: { name: "Chill", tracks: [{ videoId: "a", title: "title a" }] } });
    expect(JSON.stringify(opened)).not.toContain("u9"); // no Discord ids
    expect(await guest.ask({ kind: "queuePlaylist", playlistId: playlist.id, next: false, shuffle: false })).toEqual({
      type: "reply",
      id: expect.any(Number),
      ok: false,
      error: "Open your /join link from Discord to use playlists.",
    });
    expect(session.current).toBeUndefined();
  });

  it("makes, fills, edits and queues a playlist, pushing changes to whoever has it open", async () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a"), track("b"), track("c")] }, { by: "Bob", userId: "u2" });
    const [me, viewer] = await Promise.all([join(alice), join()]);

    const made = await me.ask({ kind: "createPlaylist", name: "Mix" });
    expect(made.ok).toBe(true);
    const { playlistId } = made.data;
    await viewer.ask({ kind: "openPlaylist", playlistId });

    const pushed = viewer.next((m) => m.type === "playlist" && m.playlist.tracks.length === 3);
    const listed = viewer.next((m) => m.type === "playlists" && m.playlists[0]?.trackCount === 3);
    const added = await me.ask({ kind: "addToPlaylist", playlistId, videoIds: ["a", "b", "c", "evil"] });
    expect(added).toMatchObject({ ok: true, data: { added: 3, duplicates: 0, name: "Mix" } });
    await Promise.all([pushed, listed]);
    expect(getPlaylist(playlistId)!.tracks.map((t) => t.addedBy)).toEqual(["u1", "u1", "u1"]);

    const moved = viewer.next((m) => m.type === "playlist" && m.playlist.tracks[0].videoId === "c");
    expect((await me.ask({ kind: "movePlaylistTrack", playlistId, from: 2, to: 0, videoId: "c" })).ok).toBe(true);
    await moved;
    expect((await me.ask({ kind: "movePlaylistTrack", playlistId, from: 2, to: 0, videoId: "c" })).error).toMatch(/changed/);

    expect((await me.ask({ kind: "removePlaylistTrack", playlistId, index: 0, videoId: "c" })).ok).toBe(true);
    expect((await me.ask({ kind: "restorePlaylistTrack", playlistId, videoId: "c" })).ok).toBe(true);
    expect(findPlaylist("g1", "mix")!.tracks.map((t) => t.videoId)).toEqual(["c", "a", "b"]);

    expect((await me.ask({ kind: "renamePlaylist", playlistId, name: "Night mix" })).ok).toBe(true);
    applyControl(session, { kind: "clear" });
    expect((await me.ask({ kind: "queuePlaylist", playlistId, next: false, shuffle: false })).ok).toBe(true);
    expect(session.queue.map((t) => [t.videoId, t.addedBy?.name, t.fromPlaylist?.name])).toEqual([
      ["c", "Alice", "Night mix"],
      ["a", "Alice", "Night mix"],
      ["b", "Alice", "Night mix"],
    ]);
    expect((await me.ask({ kind: "queuePlaylistTrack", playlistId, index: 1, videoId: "a", next: true })).ok).toBe(true);
    expect(session.queue[0]).toMatchObject({ videoId: "a", fromPlaylist: { name: "Night mix" } });
    expect(await me.ask({ kind: "playlistsWith", videoId: "a" })).toMatchObject({ data: { playlistIds: [playlistId] } });
  });

  it("refuses taken names and other guilds' playlists", async () => {
    const other = addTracks("g2", "Theirs", [track("a")], "u9") as Exclude<ReturnType<typeof addTracks>, string>;
    addTracks("g1", "Chill", [track("a")], "u9");
    const me = await join(alice);
    expect((await me.ask({ kind: "createPlaylist", name: "chill" })).error).toBe("There's already a playlist called Chill.");
    expect((await me.ask({ kind: "openPlaylist", playlistId: other.playlist.id })).error).toBe("That playlist was deleted.");
    expect((await me.ask({ kind: "deletePlaylist", playlistId: other.playlist.id })).ok).toBe(false);
    expect(getPlaylist(other.playlist.id)).toBeDefined();
  });

  it("tells viewers a deleted playlist is gone and logs who deleted it", async () => {
    const actions: LastAction[] = [];
    const stop = onAction((_s, action, silent) => !silent && actions.push(action));
    const { playlist } = addTracks("g1", "Chill", [track("a")], "u9") as Exclude<ReturnType<typeof addTracks>, string>;
    const [me, viewer] = await Promise.all([join(alice), join()]);
    await viewer.ask({ kind: "openPlaylist", playlistId: playlist.id });
    const gone = viewer.next((m) => m.type === "playlistGone" && m.playlistId === playlist.id);
    expect((await me.ask({ kind: "deletePlaylist", playlistId: playlist.id })).ok).toBe(true);
    await gone;
    stop();
    expect(actions).toEqual([{ kind: "playlistDelete", name: "Chill", count: 1, by: "Alice" }]);
  });
});

describe("adding from the site", () => {
  /** Searches return s1..s5; "blocked" can't be embedded; list links resolve to l1, l2. */
  const calls: string[] = [];
  const fake: LookupService = {
    classify(input) {
      if (input.startsWith("https://list")) return { kind: "collection", label: "YouTube playlist" };
      if (input.startsWith("https://video/")) return { kind: "video" };
      if (input.startsWith("https://")) return { kind: "unsupported", message: "Only YouTube and Spotify links are supported." };
      return { kind: "search" };
    },
    async search(query, limit) {
      calls.push(`search ${query}`);
      return query === "blocked" ? [track("blocked")] : Array.from({ length: limit }, (_, i) => track(`s${i + 1}`));
    },
    async resolve(input) {
      calls.push(`resolve ${input}`);
      if (input.startsWith("https://video/")) return { ok: true, tracks: [track(input.slice(14))] };
      return { ok: true, tracks: [track("l1"), track("l2")], playlistName: "Mix", dropped: "1 unavailable" };
    },
    async embeddable(videoId) {
      calls.push(`embeddable ${videoId}`);
      return videoId !== "blocked";
    },
  };

  beforeEach(() => {
    calls.length = 0;
    setLookupService(fake);
  });

  it("searches and queues a result, checking it can be embedded first", async () => {
    const me = await join(alice);
    expect(await me.ask({ kind: "lookup", query: "some song" })).toMatchObject({
      ok: true,
      data: { kind: "videos", tracks: [{ videoId: "s1" }, { videoId: "s2" }, {}, {}, {}] },
    });
    expect((await me.ask({ kind: "enqueueVideo", videoId: "s2", next: false })).ok).toBe(true);
    expect(session.current).toMatchObject({ videoId: "s2", addedBy: { name: "Alice", userId: "u1" } });
    expect(calls).toEqual(["search some song", "embeddable s2"]);
    // Only what it looked up.
    expect((await me.ask({ kind: "enqueueVideo", videoId: "evil", next: false })).error).toMatch(/expired/);
  });

  it("refuses videos that can't be embedded", async () => {
    const me = await join(alice);
    await me.ask({ kind: "lookup", query: "blocked" });
    expect((await me.ask({ kind: "enqueueVideo", videoId: "blocked", next: false })).error).toMatch(/doesn't allow/);
    const made = await me.ask({ kind: "createPlaylist", name: "P" });
    expect((await me.ask({ kind: "addToPlaylist", playlistId: made.data.playlistId, videoIds: ["blocked"] })).ok).toBe(false);
    expect(session.current).toBeUndefined();
  });

  it("resolves a video link right away, already checked", async () => {
    const me = await join(alice);
    expect(await me.ask({ kind: "lookup", query: "https://video/abc" })).toMatchObject({
      data: { kind: "videos", tracks: [{ videoId: "abc" }] },
    });
    expect((await me.ask({ kind: "enqueueVideo", videoId: "abc", next: true })).ok).toBe(true);
    expect(calls).toEqual(["resolve https://video/abc"]);
  });

  it("only names playlist links until they're added, to the queue or a playlist", async () => {
    const me = await join(alice);
    expect(await me.ask({ kind: "lookup", query: "https://list/1" })).toMatchObject({
      data: { kind: "collection", label: "YouTube playlist", query: "https://list/1" },
    });
    expect(calls).toEqual([]);
    expect(await me.ask({ kind: "addCollection", query: "https://list/1", next: false, playlistId: null })).toMatchObject({
      ok: true,
      data: { added: 2, name: "Mix", dropped: "1 unavailable" },
    });
    expect(session.queue.length + (session.current ? 1 : 0)).toBe(2);
    const made = await me.ask({ kind: "createPlaylist", name: "Saved" });
    expect(
      await me.ask({ kind: "addCollection", query: "https://list/1", next: false, playlistId: made.data.playlistId }),
    ).toMatchObject({ data: { added: 2, name: "Saved" } });
    expect(
      (await me.ask({ kind: "addCollection", query: "https://list/1", next: false, shuffle: true, playlistId: null })).ok,
    ).toBe(true);
    expect(session.queue.length + (session.current ? 1 : 0)).toBe(4);
    expect((await me.ask({ kind: "lookup", query: "https://example.com" })).error).toMatch(/Only YouTube/);
  });

  it(`allows ${LOOKUPS_PER_MINUTE} lookups a minute per person, and none for guests`, async () => {
    const [me, guest] = await Promise.all([join(alice), join()]);
    for (let i = 0; i < LOOKUPS_PER_MINUTE; i++) expect((await me.ask({ kind: "lookup", query: `q${i}` })).ok).toBe(true);
    expect((await me.ask({ kind: "lookup", query: "one more" })).error).toMatch(/Slow down/);
    expect((await guest.ask({ kind: "lookup", query: "hello" })).error).toMatch(/join link/);
  });
});
