// Playlists a guild keeps: named, frozen lists of videos (no lookups when
// queued) that anyone in the guild can queue or edit. Names are unique per
// guild ignoring case. Tracks record who added them, regardless of /privacy:
// that's attribution, not stats. Only works while the store has a database open.
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db.js";
import { applyControl } from "./control.js";
import type { LastAction, Session, Track } from "./session.js";

export const MAX_TRACKS = 500;
export const MAX_PLAYLISTS = 100;
export const MAX_NAME_LENGTH = 50;
/** How long a track removed from a playlist can be put back. */
export const PLAYLIST_UNDO_MS = 30_000;

export interface PlaylistSummary {
  id: number;
  name: string;
  trackCount: number;
  durationSec: number;
}

export interface PlaylistTrack {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  /** Discord user id of whoever added it. */
  addedBy?: string;
}

export interface Playlist {
  id: number;
  guildId: string;
  name: string;
  createdBy?: string;
  tracks: PlaylistTrack[];
}

export interface AddResult {
  playlist: Playlist;
  created: boolean;
  added: number;
  /** Already in the playlist (or twice in what was added). */
  duplicates: number;
  /** Didn't fit under MAX_TRACKS. */
  overflow: number;
}

interface Removed {
  track: PlaylistTrack;
  index: number;
  removedAtMs: number;
}

let db: DatabaseSync | undefined;
/** Recently removed tracks per playlist id, for undo. */
const removed = new Map<number, Removed[]>();

/** A playlist was made, edited or (when `gone`) deleted. */
type ChangeListener = (guildId: string, playlistId: number, gone: boolean) => void;
const listeners = new Set<ChangeListener>();

export function onPlaylistChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(guildId: string, playlistId: number, gone = false): void {
  for (const fn of listeners) fn(guildId, playlistId, gone);
}

export function openPlaylists(database: DatabaseSync): void {
  db = database;
  removed.clear();
}

export function closePlaylists(): void {
  db = undefined;
  removed.clear();
}

/** Whether playlists can be used (the store has a database open). */
export function playlistsOpen(): boolean {
  return db !== undefined;
}

function database(): DatabaseSync {
  if (!db) throw new Error("playlists need the database");
  return db;
}

/** The name as stored: trimmed, inner whitespace collapsed. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function nameKey(name: string): string {
  return cleanName(name).toLowerCase();
}

/** An error message for a name that can't be used, or undefined. */
export function invalidName(name: string): string | undefined {
  const clean = cleanName(name);
  if (clean.length === 0) return "Give the playlist a name.";
  if (clean.length > MAX_NAME_LENGTH) return `Playlist names can be at most ${MAX_NAME_LENGTH} characters.`;
  return undefined;
}

/** Every playlist in the guild, by name. */
export function listPlaylists(guildId: string): PlaylistSummary[] {
  const rows = database()
    .prepare(
      `SELECT p.id, p.name, COUNT(t.video_id) AS track_count, COALESCE(SUM(t.duration_sec), 0) AS duration_sec
       FROM playlists p LEFT JOIN playlist_tracks t ON t.playlist_id = p.id
       WHERE p.guild_id = ? GROUP BY p.id ORDER BY p.name_key`,
    )
    .all(guildId) as { id: number; name: string; track_count: number; duration_sec: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, trackCount: r.track_count, durationSec: r.duration_sec }));
}

export function getPlaylist(id: number): Playlist | undefined {
  const row = database().prepare("SELECT id, guild_id, name, created_by FROM playlists WHERE id = ?").get(id) as
    | { id: number; guild_id: string; name: string; created_by: string | null }
    | undefined;
  if (!row) return undefined;
  const tracks = database()
    .prepare(
      `SELECT video_id, title, author, duration_sec, added_by FROM playlist_tracks
       WHERE playlist_id = ? ORDER BY position`,
    )
    .all(id) as { video_id: string; title: string; author: string; duration_sec: number; added_by: string | null }[];
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    tracks: tracks.map((t) => ({
      videoId: t.video_id,
      title: t.title,
      author: t.author,
      durationSec: t.duration_sec,
      ...(t.added_by ? { addedBy: t.added_by } : {}),
    })),
  };
}

export function findPlaylist(guildId: string, name: string): Playlist | undefined {
  const row = database()
    .prepare("SELECT id FROM playlists WHERE guild_id = ? AND name_key = ?")
    .get(guildId, nameKey(name)) as { id: number } | undefined;
  return row && getPlaylist(row.id);
}

/** Makes an empty playlist; an error message when the name is taken or invalid. */
export function createPlaylist(guildId: string, name: string, userId: string): Playlist | string {
  const invalid = invalidName(name);
  if (invalid) return invalid;
  const existing = findPlaylist(guildId, name);
  if (existing) return `There's already a playlist called **${existing.name}**.`;
  if (listPlaylists(guildId).length >= MAX_PLAYLISTS) {
    return `This server already has ${MAX_PLAYLISTS} playlists; delete one first.`;
  }
  const id = Number(
    database()
      .prepare("INSERT INTO playlists (guild_id, name, name_key, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, cleanName(name), nameKey(name), userId, Date.now()).lastInsertRowid,
  );
  changed(guildId, id);
  return getPlaylist(id)!;
}

/**
 * Adds tracks to the named playlist, creating it when it doesn't exist.
 * Skips videos already in it and whatever doesn't fit; an error message when
 * nothing could be done.
 */
export function addTracks(guildId: string, name: string, tracks: Track[], userId: string): AddResult | string {
  const invalid = invalidName(name);
  if (invalid) return invalid;
  let playlist = findPlaylist(guildId, name);
  const created = !playlist;
  if (!playlist) {
    if (tracks.length === 0) return "Nothing to add.";
    const made = createPlaylist(guildId, name, userId);
    if (typeof made === "string") return made;
    playlist = made;
  }
  const result = addTracksTo(playlist.id, tracks, userId);
  return typeof result === "string" ? result : { ...result, created };
}

/** Adds tracks to a playlist, skipping videos already in it and whatever doesn't fit. */
export function addTracksTo(id: number, tracks: Track[], userId: string): AddResult | string {
  const playlist = getPlaylist(id);
  if (!playlist) return "That playlist doesn't exist anymore.";
  if (playlist.tracks.length >= MAX_TRACKS) return `**${playlist.name}** is full (${MAX_TRACKS} tracks).`;

  const have = new Set(playlist.tracks.map((t) => t.videoId));
  const fresh: Track[] = [];
  let duplicates = 0;
  for (const track of tracks) {
    if (have.has(track.videoId)) duplicates++;
    else {
      have.add(track.videoId);
      fresh.push(track);
    }
  }
  const adding = fresh.slice(0, MAX_TRACKS - playlist.tracks.length);
  const overflow = fresh.length - adding.length;

  const d = database();
  const now = Date.now();
  const base = playlist.tracks.length;
  transaction(d, () => {
    const insert = d.prepare(
      `INSERT INTO playlist_tracks (playlist_id, video_id, position, title, author, duration_sec, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    adding.forEach((t, i) => insert.run(id, t.videoId, base + i, t.title, t.author, t.durationSec, userId, now));
  });
  if (adding.length > 0) changed(playlist.guildId, id);
  return { playlist: getPlaylist(id)!, created: false, added: adding.length, duplicates, overflow };
}

/** Ids of the guild's playlists that hold `videoId`. */
export function playlistsWith(guildId: string, videoId: string): number[] {
  const rows = database()
    .prepare(
      `SELECT p.id FROM playlists p JOIN playlist_tracks t ON t.playlist_id = p.id
       WHERE p.guild_id = ? AND t.video_id = ?`,
    )
    .all(guildId, videoId) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Writes the tracks' positions in the given order. */
function renumber(id: number, order: string[]): void {
  const d = database();
  const set = d.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND video_id = ?");
  transaction(d, () => order.forEach((videoId, i) => set.run(i, id, videoId)));
}

/** Removes the track at `index` if it's still `videoId`; it can be put back for a while. */
export function removeTrack(id: number, index: number, videoId: string, nowMs = Date.now()): PlaylistTrack | undefined {
  const playlist = getPlaylist(id);
  const track = playlist?.tracks[index];
  if (!playlist || track?.videoId !== videoId) return undefined;
  database().prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?").run(id, videoId);
  renumber(
    id,
    playlist.tracks.filter((_, i) => i !== index).map((t) => t.videoId),
  );
  const list = (removed.get(id) ?? []).filter((r) => nowMs - r.removedAtMs < PLAYLIST_UNDO_MS);
  list.push({ track, index, removedAtMs: nowMs });
  removed.set(id, list);
  changed(playlist.guildId, id);
  return track;
}

/** Puts back a track removed in the last PLAYLIST_UNDO_MS, where it was. */
export function restoreTrack(id: number, videoId: string, nowMs = Date.now()): PlaylistTrack | undefined {
  const list = (removed.get(id) ?? []).filter((r) => nowMs - r.removedAtMs < PLAYLIST_UNDO_MS);
  const at = list.map((r) => r.track.videoId).lastIndexOf(videoId);
  const playlist = getPlaylist(id);
  if (at === -1 || !playlist) return undefined;
  const [{ track, index }] = list.splice(at, 1) as [Removed];
  removed.set(id, list);
  // Re-added meanwhile, or filled up.
  if (playlist.tracks.some((t) => t.videoId === videoId) || playlist.tracks.length >= MAX_TRACKS) return undefined;
  database()
    .prepare(
      `INSERT INTO playlist_tracks (playlist_id, video_id, position, title, author, duration_sec, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, track.videoId, playlist.tracks.length, track.title, track.author, track.durationSec, track.addedBy ?? null, nowMs);
  const order = playlist.tracks.map((t) => t.videoId);
  order.splice(Math.min(index, order.length), 0, videoId);
  renumber(id, order);
  changed(playlist.guildId, id);
  return track;
}

/** Moves the track at `from` (if it's still `videoId`) to `to`. */
export function moveTrack(id: number, from: number, to: number, videoId: string): PlaylistTrack | undefined {
  const playlist = getPlaylist(id);
  const track = playlist?.tracks[from];
  if (!playlist || track?.videoId !== videoId || to < 0 || to >= playlist.tracks.length || from === to) return undefined;
  const order = playlist.tracks.map((t) => t.videoId);
  order.splice(from, 1);
  order.splice(to, 0, videoId);
  renumber(id, order);
  changed(playlist.guildId, id);
  return track;
}

/** An error message, or undefined once renamed. Changing only the case is fine. */
export function renamePlaylist(id: number, newName: string): string | undefined {
  const invalid = invalidName(newName);
  if (invalid) return invalid;
  const playlist = getPlaylist(id);
  if (!playlist) return "That playlist doesn't exist anymore.";
  const other = findPlaylist(playlist.guildId, newName);
  if (other && other.id !== id) return `There's already a playlist called **${other.name}**.`;
  database()
    .prepare("UPDATE playlists SET name = ?, name_key = ? WHERE id = ?")
    .run(cleanName(newName), nameKey(newName), id);
  changed(playlist.guildId, id);
  return undefined;
}

export function deletePlaylist(id: number): boolean {
  removed.delete(id);
  const row = database().prepare("SELECT guild_id FROM playlists WHERE id = ?").get(id) as { guild_id: string } | undefined;
  if (!row) return false;
  database().prepare("DELETE FROM playlists WHERE id = ?").run(id);
  changed(row.guild_id, id, true);
  return true;
}

/** The bot left the guild: its playlists go with its room. */
export function forgetGuildPlaylists(guildId: string): void {
  if (!db) return;
  const ids = db.prepare("SELECT id FROM playlists WHERE guild_id = ?").all(guildId) as { id: number }[];
  for (const { id } of ids) removed.delete(id);
  db.prepare("DELETE FROM playlists WHERE guild_id = ?").run(guildId);
}

/** A playlist's tracks ready to queue, each marked with where it came from. */
export function queueable(playlist: Playlist): Track[] {
  const from = { id: playlist.id, name: playlist.name };
  return playlist.tracks.map(({ videoId, title, author, durationSec }) => ({
    videoId,
    title,
    author,
    durationSec,
    fromPlaylist: from,
  }));
}

/** The same tracks in random order (a copy). */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Queues a whole playlist; the error message, or what was queued. */
export function queuePlaylist(
  session: Session,
  playlist: Playlist,
  opts: { by?: string; userId?: string; silent?: boolean; next?: boolean; shuffle?: boolean },
): string | LastAction {
  if (playlist.tracks.length === 0) return `**${playlist.name}** is empty.`;
  const tracks = opts.shuffle ? shuffled(queueable(playlist)) : queueable(playlist);
  return applyControl(
    session,
    { kind: "enqueue", tracks, next: opts.next ?? false },
    {
      ...(opts.by ? { by: opts.by } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.silent ? { silent: true } : {}),
      label: playlist.name,
      playlist: { id: playlist.id, name: playlist.name },
    },
  )!;
}
