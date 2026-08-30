import { config } from "../config.js";
import { logger } from "../logger.js";
import { getDb } from "./db/index.js";

const QUERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VIDEO_ID_RE = /^([a-zA-Z0-9_-]{11})$/;
const SPOTIFY_HOST = "open.spotify.com";

export interface ResolvedTrack {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
}

export type ResolveResult =
  | { ok: true; tracks: ResolvedTrack[]; sourceLabel?: string }
  | {
      ok: false;
      reason: "not-found" | "error" | "spotify-not-configured";
      detail?: string;
    };

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
    sourceName?: string;
    uri?: string;
  };
}

type LoadResult =
  | { kind: "single"; track: LavalinkTrack }
  | { kind: "playlist"; name: string; tracks: LavalinkTrack[] }
  | { kind: "empty" };

type LoadTracksResponse =
  | { loadType: "track"; data: LavalinkTrack }
  | { loadType: "search"; data: LavalinkTrack[] }
  | {
      loadType: "playlist";
      data: { info: { name: string; selectedTrack?: number }; tracks: LavalinkTrack[] };
    }
  | { loadType: "empty"; data: null }
  | {
      loadType: "error";
      data: { message: string; severity: string; cause?: string };
    };

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

function looksLikeUrl(input: string): boolean {
  const t = input.trim();
  return t.startsWith("http://") || t.startsWith("https://") || VIDEO_ID_RE.test(t);
}

function isSpotifyUrl(input: string): boolean {
  const t = input.trim();
  try {
    return new URL(t).hostname === SPOTIFY_HOST;
  } catch {
    return false;
  }
}

function isSpotifyConfigured(): boolean {
  return !!(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET);
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

export async function loadTracks(identifier: string): Promise<LoadResult> {
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
      return { kind: "empty" };
    case "error":
      throw new Error(`loadtracks error: ${data.data.message}`);
    case "track":
      return { kind: "single", track: data.data };
    case "search": {
      const first = data.data[0];
      return first ? { kind: "single", track: first } : { kind: "empty" };
    }
    case "playlist":
      return {
        kind: "playlist",
        name: data.data.info.name,
        tracks: data.data.tracks,
      };
  }
}

function trackFromLavalink(raw: LavalinkTrack): ResolvedTrack {
  return {
    videoId: raw.info.identifier,
    title: raw.info.title,
    author: raw.info.author,
    durationSec: Math.round(raw.info.length / 1000),
  };
}

function playableTracks(raw: LavalinkTrack[]): ResolvedTrack[] {
  const out: ResolvedTrack[] = [];
  for (const r of raw) {
    if (r.info.isStream) continue;
    if (!r.info.identifier) continue;
    out.push(trackFromLavalink(r));
    saveVideoToCache(out[out.length - 1]!);
  }
  return out;
}

async function resolveByVideoId(videoId: string): Promise<ResolveResult> {
  const cached = getVideoFromCache(videoId);
  if (cached) return { ok: true, tracks: [cached] };
  const result = await loadTracks(`https://www.youtube.com/watch?v=${videoId}`);
  if (result.kind !== "single" || result.track.info.isStream) {
    return { ok: false, reason: "not-found" };
  }
  const track = { ...trackFromLavalink(result.track), videoId };
  saveVideoToCache(track);
  return { ok: true, tracks: [track] };
}

export async function resolveInput(input: string): Promise<ResolveResult> {
  try {
    if (looksLikeUrl(input)) {
      if (isSpotifyUrl(input) && !isSpotifyConfigured()) {
        return { ok: false, reason: "spotify-not-configured" };
      }

      // YouTube URL / bare id fast path preserves the videoId cache hit.
      const ytVideoId = extractVideoId(input);
      if (ytVideoId) return await resolveByVideoId(ytVideoId);

      // Anything else with a URL shape (Spotify, or unusual YouTube URLs
      // extractVideoId doesn't catch) goes straight to Lavalink.
      const result = await loadTracks(input);
      if (result.kind === "empty") {
        if (isSpotifyUrl(input) && !isSpotifyConfigured()) {
          return { ok: false, reason: "spotify-not-configured" };
        }
        return { ok: false, reason: "not-found" };
      }
      if (result.kind === "single") {
        if (result.track.info.isStream) return { ok: false, reason: "not-found" };
        const track = trackFromLavalink(result.track);
        saveVideoToCache(track);
        return { ok: true, tracks: [track] };
      }
      // playlist
      const tracks = playableTracks(result.tracks);
      if (tracks.length === 0) return { ok: false, reason: "not-found" };
      return { ok: true, tracks, sourceLabel: result.name };
    }

    // text query path — YouTube search via Lavalink, unchanged behavior
    const query = input.trim();
    const cachedVideoId = getQueryFromCache(query);
    if (cachedVideoId) {
      const cached = getVideoFromCache(cachedVideoId);
      if (cached) return { ok: true, tracks: [cached] };
    }

    const result = await loadTracks(`ytsearch:${query}`);
    if (result.kind !== "single" || result.track.info.isStream) {
      return { ok: false, reason: "not-found" };
    }
    const track = trackFromLavalink(result.track);
    saveVideoToCache(track);
    saveQueryToCache(query, track.videoId);
    return { ok: true, tracks: [track] };
  } catch (err) {
    logger.error({ err, input }, "resolveInput failed");
    return { ok: false, reason: "error", detail: (err as Error).message };
  }
}

export function getGuildSetting(guildId: string): {
  skipmode: string;
  voteThreshold: number;
  autoplay: boolean;
} {
  const row = getDb()
    .prepare(
      "SELECT skipmode, vote_threshold, autoplay FROM guild_settings WHERE guild_id = ?",
    )
    .get(guildId) as
    | { skipmode: string; vote_threshold: number; autoplay: number }
    | undefined;
  return {
    skipmode: row?.skipmode ?? "anyone",
    voteThreshold: row?.vote_threshold ?? 0.5,
    autoplay: row ? row.autoplay !== 0 : true,
  };
}

export function setGuildSkipmode(
  guildId: string,
  mode: "anyone" | "vote" | "dj",
): void {
  getDb()
    .prepare(
      "INSERT INTO guild_settings (guild_id, skipmode) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET skipmode = excluded.skipmode",
    )
    .run(guildId, mode);
}

export function setGuildAutoplay(guildId: string, on: boolean): void {
  getDb()
    .prepare(
      "INSERT INTO guild_settings (guild_id, autoplay) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET autoplay = excluded.autoplay",
    )
    .run(guildId, on ? 1 : 0);
}

export function getVideoMetadata(
  videoId: string,
): { title: string; author: string; durationSec: number } | null {
  const row = getDb()
    .prepare(
      "SELECT title, author, duration_sec FROM video_cache WHERE video_id = ?",
    )
    .get(videoId) as
    | { title: string; author: string; duration_sec: number }
    | undefined;
  if (!row) return null;
  return {
    title: row.title,
    author: row.author,
    durationSec: row.duration_sec,
  };
}
