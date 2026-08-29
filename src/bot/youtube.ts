import { config } from "../config.js";
import { logger } from "../logger.js";
import { getDb } from "./db/index.js";

const QUERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VIDEO_ID_RE = /^([a-zA-Z0-9_-]{11})$/;

export interface ResolvedTrack {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
}

export type ResolveResult =
  | { ok: true; track: ResolvedTrack }
  | { ok: false; reason: "not-found" | "error"; detail?: string };

interface VideoRow {
  video_id: string;
  title: string;
  author: string;
  duration_sec: number;
}

interface QueryRow {
  video_id: string;
  cached_at: number;
}

interface LavalinkTrack {
  info: {
    identifier: string;
    title: string;
    author: string;
    length: number;
    isStream: boolean;
  };
}

type LoadTracksResponse =
  | { loadType: "track"; data: LavalinkTrack }
  | { loadType: "search"; data: LavalinkTrack[] }
  | { loadType: "playlist"; data: { tracks: LavalinkTrack[] } }
  | { loadType: "empty"; data: null }
  | { loadType: "error"; data: { message: string; severity: string; cause?: string } };

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") {
      const path = url.pathname.slice(1);
      if (VIDEO_ID_RE.test(path)) return path;
    }
    if (url.hostname.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && VIDEO_ID_RE.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      const shortsIdx = parts.indexOf("shorts");
      if (shortsIdx !== -1) {
        const id = parts[shortsIdx + 1];
        if (id && VIDEO_ID_RE.test(id)) return id;
      }
    }
  } catch {
    // not a URL
  }
  return null;
}

function looksLikeUrlOrId(input: string): boolean {
  const t = input.trim();
  return t.startsWith("http://") || t.startsWith("https://") || VIDEO_ID_RE.test(t);
}

function getVideoFromCache(videoId: string): ResolvedTrack | null {
  const row = getDb()
    .prepare(
      "SELECT video_id, title, author, duration_sec FROM video_cache WHERE video_id = ?",
    )
    .get(videoId) as VideoRow | undefined;
  if (!row) return null;
  return {
    videoId: row.video_id,
    title: row.title,
    author: row.author,
    durationSec: row.duration_sec,
  };
}

function saveVideoToCache(t: ResolvedTrack): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO video_cache (video_id, title, author, duration_sec, cached_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(t.videoId, t.title, t.author, t.durationSec, Date.now());
}

function getQueryFromCache(query: string): string | null {
  const row = getDb()
    .prepare("SELECT video_id, cached_at FROM query_cache WHERE query = ?")
    .get(query.toLowerCase()) as QueryRow | undefined;
  if (!row) return null;
  if (Date.now() - row.cached_at > QUERY_TTL_MS) return null;
  return row.video_id;
}

function saveQueryToCache(query: string, videoId: string): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO query_cache (query, video_id, cached_at) VALUES (?, ?, ?)",
    )
    .run(query.toLowerCase(), videoId, Date.now());
}

async function loadTracks(identifier: string): Promise<LavalinkTrack | null> {
  const url = new URL("/v4/loadtracks", config.LAVALINK_URL);
  url.searchParams.set("identifier", identifier);
  const res = await fetch(url, {
    headers: { Authorization: config.LAVALINK_PASSWORD },
  });
  if (!res.ok) {
    throw new Error(`loadtracks ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as LoadTracksResponse;
  switch (data.loadType) {
    case "empty":
      return null;
    case "error":
      throw new Error(`loadtracks error: ${data.data.message}`);
    case "track":
      return data.data;
    case "search":
      return data.data[0] ?? null;
    case "playlist":
      return data.data.tracks[0] ?? null;
  }
}

function trackFromLavalink(raw: LavalinkTrack, fallbackVideoId?: string): ResolvedTrack {
  return {
    videoId: fallbackVideoId ?? raw.info.identifier,
    title: raw.info.title,
    author: raw.info.author,
    durationSec: Math.round(raw.info.length / 1000),
  };
}

async function resolveByVideoId(videoId: string): Promise<ResolveResult> {
  const cached = getVideoFromCache(videoId);
  if (cached) return { ok: true, track: cached };
  const raw = await loadTracks(`https://www.youtube.com/watch?v=${videoId}`);
  if (!raw || raw.info.isStream) return { ok: false, reason: "not-found" };
  const track = trackFromLavalink(raw, videoId);
  saveVideoToCache(track);
  return { ok: true, track };
}

export async function resolveInput(input: string): Promise<ResolveResult> {
  try {
    if (looksLikeUrlOrId(input)) {
      const videoId = extractVideoId(input);
      if (!videoId) {
        return { ok: false, reason: "error", detail: "could not extract video id from URL" };
      }
      return await resolveByVideoId(videoId);
    }

    const query = input.trim();
    const cachedVideoId = getQueryFromCache(query);
    if (cachedVideoId) {
      const cached = getVideoFromCache(cachedVideoId);
      if (cached) return { ok: true, track: cached };
    }

    const raw = await loadTracks(`ytsearch:${query}`);
    if (!raw || raw.info.isStream) return { ok: false, reason: "not-found" };
    const track = trackFromLavalink(raw);
    saveVideoToCache(track);
    saveQueryToCache(query, track.videoId);
    return { ok: true, track };
  } catch (err) {
    logger.error({ err, input }, "youtube resolveInput failed");
    return { ok: false, reason: "error", detail: (err as Error).message };
  }
}

export function getGuildSetting(guildId: string): { skipmode: string; voteThreshold: number } {
  const row = getDb()
    .prepare("SELECT skipmode, vote_threshold FROM guild_settings WHERE guild_id = ?")
    .get(guildId) as { skipmode: string; vote_threshold: number } | undefined;
  return {
    skipmode: row?.skipmode ?? "anyone",
    voteThreshold: row?.vote_threshold ?? 0.5,
  };
}

export function setGuildSkipmode(guildId: string, mode: "anyone" | "vote" | "dj"): void {
  getDb()
    .prepare(
      "INSERT INTO guild_settings (guild_id, skipmode) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET skipmode = excluded.skipmode",
    )
    .run(guildId, mode);
}

export function getVideoMetadata(videoId: string): { title: string; author: string; durationSec: number } | null {
  const row = getDb()
    .prepare("SELECT title, author, duration_sec FROM video_cache WHERE video_id = ?")
    .get(videoId) as { title: string; author: string; duration_sec: number } | undefined;
  if (!row) return null;
  return { title: row.title, author: row.author, durationSec: row.duration_sec };
}
