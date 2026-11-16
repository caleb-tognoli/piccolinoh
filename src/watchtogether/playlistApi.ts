// The site's requests: guild playlists and adding tracks (searches and links),
// each answered with a reply. Only named browsers (a /join link with a Discord
// id) may change anything. What browsers see of a playlist leaves out Discord ids.
import { applyControl } from "./control.js";
import {
  checkEmbeddable,
  type LookupEntry,
  lookupService,
  LOOKUPS_PER_MINUTE,
  oneAtATime,
  remember,
  SEARCH_RESULTS,
  takeLookup,
} from "./lookups.js";
import {
  addTracksTo,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  moveTrack,
  type Playlist,
  type PlaylistSummary,
  playlistsWith,
  queuePlaylist,
  queueable,
  removeTrack,
  renamePlaylist,
  restoreTrack,
  shuffled,
} from "./playlists.js";
import type { PlaylistRequest } from "./protocol.js";
import { emitAction, type Session, type Track } from "./session.js";

/** Who sent a request, from their socket. */
export interface Caller {
  session: Session;
  /** Display name from the join link. */
  name?: string;
  /** Discord user id from the join link; required to change anything. */
  userId?: string;
  /** Videos this browser looked up lately, by id, so it can add them by id. */
  lookups?: Map<string, LookupEntry>;
}

export type Reply = { ok: true; data?: unknown } | { ok: false; error: string };

/** A playlist as browsers see it. */
export interface PlaylistDetail {
  id: number;
  name: string;
  tracks: { videoId: string; title: string; author: string; durationSec: number }[];
}

export const NAMED_ONLY = "Open your /join link from Discord to use playlists.";

export function playlistSummaries(guildId: string): PlaylistSummary[] {
  return listPlaylists(guildId);
}

export function playlistDetail(playlist: Playlist): PlaylistDetail {
  return {
    id: playlist.id,
    name: playlist.name,
    tracks: playlist.tracks.map(({ videoId, title, author, durationSec }) => ({ videoId, title, author, durationSec })),
  };
}

/** Error messages are written for Discord; browsers get them without the bold markers. */
function fail(message: string): Reply {
  return { ok: false, error: message.replace(/\*\*/g, "") };
}

const ok = (data?: unknown): Reply => (data === undefined ? { ok: true } : { ok: true, data });

/** The guild's playlist `id`, or undefined (missing, or another guild's). */
function own(caller: Caller, id: number): Playlist | undefined {
  const playlist = getPlaylist(id);
  return playlist?.guildId === caller.session.guildId ? playlist : undefined;
}

/**
 * Videos the caller may add by id: what the room has (already playable), then
 * their own lookups (checked for embedding first).
 */
async function known(caller: Caller, ids: string[]): Promise<{ tracks: Track[]; blocked: number }> {
  const { current, queue, history } = caller.session;
  const room = new Map<string, Track>();
  for (const t of [...history, ...queue]) room.set(t.videoId, t);
  if (current) {
    const { startedAtServerMs: _s, pausedAtPositionSec: _p, ...track } = current;
    room.set(track.videoId, track);
  }
  const found = await Promise.all(
    ids.map(async (id) => {
      const inRoom = room.get(id);
      if (inRoom) return { track: inRoom, ok: true };
      const entry = caller.lookups?.get(id);
      if (!entry) return undefined;
      return { track: entry.track, ok: await checkEmbeddable(entry) };
    }),
  );
  const present = found.filter((f) => f !== undefined);
  return { tracks: present.filter((f) => f.ok).map((f) => f.track), blocked: present.filter((f) => !f.ok).length };
}

const BLOCKED = "Its owner doesn't allow playing it on other sites.";
const SLOW_DOWN = `Slow down: ${LOOKUPS_PER_MINUTE} searches a minute.`;

/** A search or link typed into an Add box. */
async function lookup(caller: Caller, userId: string, query: string): Promise<Reply> {
  const service = lookupService();
  if (!service) return fail("Searching isn't available right now.");
  const input = service.classify(query);
  if (input.kind === "unsupported") return fail(input.message);
  // Playlists and albums are only named here; resolving them waits for Add.
  if (input.kind === "collection") return ok({ kind: "collection", label: input.label, query });
  if (!takeLookup(userId)) return fail(SLOW_DOWN);
  if (input.kind === "video") {
    const resolved = await service.resolve(query);
    if (!resolved.ok) return fail(resolved.message);
    if (caller.lookups) remember(caller.lookups, resolved.tracks, true);
    return ok({ kind: "videos", tracks: resolved.tracks });
  }
  const tracks = await service.search(query, SEARCH_RESULTS);
  if (caller.lookups) remember(caller.lookups, tracks);
  return ok({ kind: "videos", tracks });
}

/** A playlist or album link, resolved when someone adds it. */
async function addCollection(
  caller: Caller,
  userId: string,
  request: { query: string; next: boolean; shuffle?: boolean | undefined; playlistId: number | null },
): Promise<Reply> {
  const service = lookupService();
  if (!service) return fail("Searching isn't available right now.");
  const target = request.playlistId === null ? undefined : own(caller, request.playlistId);
  if (request.playlistId !== null && !target) return fail("That playlist was deleted.");
  if (!takeLookup(userId)) return fail(SLOW_DOWN);
  const resolved = await oneAtATime(() => service.resolve(request.query));
  if (!resolved.ok) return fail(resolved.message);
  const dropped = resolved.dropped ? { dropped: resolved.dropped } : {};
  if (target) {
    const added = addTracksTo(target.id, resolved.tracks, userId);
    if (typeof added === "string") return fail(added);
    return ok({
      added: added.added,
      duplicates: added.duplicates,
      overflow: added.overflow,
      name: added.playlist.name,
      ...dropped,
    });
  }
  applyControl(
    caller.session,
    { kind: "enqueue", tracks: request.shuffle ? shuffled(resolved.tracks) : resolved.tracks, next: request.next },
    { ...by(caller), ...(resolved.playlistName ? { label: resolved.playlistName } : {}) },
  );
  return ok({ added: resolved.tracks.length, ...(resolved.playlistName ? { name: resolved.playlistName } : {}), ...dropped });
}

function by(caller: Caller) {
  return { ...(caller.name ? { by: caller.name } : {}), ...(caller.userId ? { userId: caller.userId } : {}) };
}

/** Answers a request. `follow` switches which playlist's tracks this browser is sent. */
export async function handlePlaylistRequest(
  caller: Caller,
  request: PlaylistRequest,
  follow: (id: number | null) => void,
): Promise<Reply> {
  if (request.kind === "openPlaylist") {
    if (request.playlistId === null) {
      follow(null);
      return ok();
    }
    const playlist = own(caller, request.playlistId);
    if (!playlist) return fail("That playlist was deleted.");
    follow(playlist.id);
    return ok(playlistDetail(playlist));
  }

  const userId = caller.userId;
  if (!userId) return fail(NAMED_ONLY);
  const { session } = caller;

  if (request.kind === "createPlaylist") {
    const made = createPlaylist(session.guildId, request.name, userId);
    return typeof made === "string" ? fail(made) : ok({ playlistId: made.id });
  }
  if (request.kind === "playlistsWith") return ok({ playlistIds: playlistsWith(session.guildId, request.videoId) });
  if (request.kind === "lookup") return lookup(caller, userId, request.query);
  if (request.kind === "addCollection") return addCollection(caller, userId, request);
  if (request.kind === "enqueueVideo") {
    const { tracks, blocked } = await known(caller, [request.videoId]);
    if (tracks.length === 0) return fail(blocked > 0 ? BLOCKED : "Search again: that result has expired.");
    applyControl(session, { kind: "enqueue", tracks, next: request.next }, by(caller));
    return ok();
  }

  const playlist = own(caller, request.playlistId);
  if (!playlist) return fail("That playlist was deleted.");
  const from = { id: playlist.id, name: playlist.name };

  switch (request.kind) {
    case "renamePlaylist": {
      const error = renamePlaylist(playlist.id, request.name);
      return error ? fail(error) : ok();
    }
    case "deletePlaylist":
      deletePlaylist(playlist.id);
      emitAction(session, {
        kind: "playlistDelete",
        name: playlist.name,
        count: playlist.tracks.length,
        ...(caller.name ? { by: caller.name } : {}),
      });
      return ok();
    case "queuePlaylist": {
      const outcome = queuePlaylist(session, playlist, { ...by(caller), next: request.next, shuffle: request.shuffle });
      return typeof outcome === "string" ? fail(outcome) : ok();
    }
    case "queuePlaylistTrack": {
      if (playlist.tracks[request.index]?.videoId !== request.videoId) return fail("The playlist changed; try again.");
      const track = queueable(playlist)[request.index]!;
      applyControl(session, { kind: "enqueue", tracks: [track], next: request.next }, { ...by(caller), playlist: from });
      return ok();
    }
    case "movePlaylistTrack":
      return moveTrack(playlist.id, request.from, request.to, request.videoId)
        ? ok()
        : fail("The playlist changed; try again.");
    case "removePlaylistTrack":
      return removeTrack(playlist.id, request.index, request.videoId)
        ? ok()
        : fail("The playlist changed; try again.");
    case "restorePlaylistTrack":
      return restoreTrack(playlist.id, request.videoId) ? ok() : fail("Too late to put it back.");
    case "addToPlaylist": {
      const { tracks, blocked } = await known(caller, request.videoIds);
      if (tracks.length === 0) return fail(blocked > 0 ? BLOCKED : "Those videos aren't in the room anymore.");
      const added = addTracksTo(playlist.id, tracks, userId);
      if (typeof added === "string") return fail(added);
      const { added: count, duplicates, overflow } = added;
      return ok({ added: count, duplicates, overflow, name: added.playlist.name });
    }
  }
}
