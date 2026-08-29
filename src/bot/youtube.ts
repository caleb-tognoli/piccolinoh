import { config } from "../config.js";
import { logger } from "../logger.js";
import { getDb } from "./db/index.js";

const QUERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_QUOTA = 9999;
const VIDEO_ID_RE = /^([a-zA-Z0-9_-]{11})$/;

export interface ResolvedTrack {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
}

export type ResolveResult =
  | { ok: true; track: ResolvedTrack }
  | { ok: false; reason: "not-found" | "quota-exhausted" | "error"; detail?: string };

interface VideoRow {
  video_id: string;
  title: string;
  author: string;
  duration_sec: number;
}

interface QuotaRow {
  units_used: number;
}

interface QueryRow {
  video_id: string;
  cached_at: number;
}

interface VideoListItem {
  snippet?: { title: string; channelTitle: string };
  contentDetails?: { duration: string };
}

interface VideoListResponse {
  items?: VideoListItem[];
}

interface SearchListItem {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string };
}

interface SearchListResponse {
  items?: SearchListItem[];
}

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

function parseIsoDuration(iso: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const mm = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + mm * 60 + s;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function getQuotaUsed(): number {
  const row = getDb()
    .prepare("SELECT units_used FROM youtube_quota WHERE day = ?")
    .get(todayUtc()) as QuotaRow | undefined;
  return row?.units_used ?? 0;
}

function bumpQuota(cost: number): void {
  getDb()
    .prepare(
      "INSERT INTO youtube_quota (day, units_used) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET units_used = units_used + excluded.units_used",
    )
    .run(todayUtc(), cost);
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

async function fetchVideosList(
  videoId: string,
  parts: string[],
): Promise<VideoListItem | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("id", videoId);
  url.searchParams.set("part", parts.join(","));
  url.searchParams.set("key", config.YOUTUBE_API_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as VideoListResponse;
  return data.items?.[0] ?? null;
}

async function fetchSearchList(query: string): Promise<SearchListItem | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("q", query);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("key", config.YOUTUBE_API_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search.list ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as SearchListResponse;
  return data.items?.[0] ?? null;
}

async function resolveByVideoId(videoId: string): Promise<ResolveResult> {
  const cached = getVideoFromCache(videoId);
  if (cached) return { ok: true, track: cached };
  if (getQuotaUsed() + 1 > DAILY_QUOTA) return { ok: false, reason: "quota-exhausted" };
  const item = await fetchVideosList(videoId, ["snippet", "contentDetails"]);
  bumpQuota(1);
  if (!item?.snippet || !item.contentDetails) return { ok: false, reason: "not-found" };
  const durationSec = parseIsoDuration(item.contentDetails.duration);
  if (durationSec == null) return { ok: false, reason: "error", detail: "unrecognized duration" };
  const track: ResolvedTrack = {
    videoId,
    title: item.snippet.title,
    author: item.snippet.channelTitle,
    durationSec,
  };
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

    if (getQuotaUsed() + 101 > DAILY_QUOTA) return { ok: false, reason: "quota-exhausted" };

    const searchResult = await fetchSearchList(query);
    bumpQuota(100);
    if (!searchResult) return { ok: false, reason: "not-found" };

    const detail = await fetchVideosList(searchResult.id.videoId, ["contentDetails"]);
    bumpQuota(1);
    if (!detail?.contentDetails) return { ok: false, reason: "not-found" };
    const durationSec = parseIsoDuration(detail.contentDetails.duration);
    if (durationSec == null) return { ok: false, reason: "error", detail: "unrecognized duration" };

    const track: ResolvedTrack = {
      videoId: searchResult.id.videoId,
      title: searchResult.snippet.title,
      author: searchResult.snippet.channelTitle,
      durationSec,
    };
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
