// Finding videos from the site: searches and links typed into an Add box. The
// actual lookups are the Discord bot's (YouTube, Spotify), handed in with
// setLookupService. Each named person gets LOOKUPS_PER_MINUTE searches or
// link lookups; checking that a picked video can be embedded doesn't count.
// Lookups that resolve many videos (playlists, albums) run one at a time.
import { logger } from "../logger.js";
import type { Track } from "./session.js";

export const LOOKUPS_PER_MINUTE = 25;
const WINDOW_MS = 60_000;
/** How many looked-up videos a browser remembers, so it can add them by id. */
export const LOOKUP_CACHE_SIZE = 200;
export const SEARCH_RESULTS = 5;

/** What a typed input is, decided without any lookup. */
export type InputKind =
  | { kind: "search" }
  | { kind: "video" }
  | { kind: "collection"; label: string }
  | { kind: "unsupported"; message: string };

export type Resolved =
  | { ok: true; tracks: Track[]; playlistName?: string; dropped?: string }
  | { ok: false; message: string };

export interface LookupService {
  classify(input: string): InputKind;
  /** Top results for free text, unchecked for embedding. */
  search(query: string, limit: number): Promise<Track[]>;
  /** Everything a link or search stands for, embedding checked (like /play). */
  resolve(input: string): Promise<Resolved>;
  embeddable(videoId: string): Promise<boolean>;
}

let service: LookupService | undefined;

export function setLookupService(s: LookupService | undefined): void {
  service = s;
}

export function lookupService(): LookupService | undefined {
  return service;
}

/** A video a browser looked up; `embeddable` once known. */
export interface LookupEntry {
  track: Track;
  embeddable?: boolean;
}

/** Remembers looked-up videos for a browser, dropping the oldest past the cap. */
export function remember(cache: Map<string, LookupEntry>, tracks: Track[], embeddable?: boolean): void {
  for (const track of tracks) {
    cache.delete(track.videoId);
    cache.set(track.videoId, { track, ...(embeddable !== undefined ? { embeddable } : {}) });
  }
  while (cache.size > LOOKUP_CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

const recent = new Map<string, number[]>();

/** Counts a lookup for `userId`; false when they're over the limit. */
export function takeLookup(userId: string, nowMs = Date.now()): boolean {
  const times = (recent.get(userId) ?? []).filter((t) => nowMs - t < WINDOW_MS);
  if (times.length >= LOOKUPS_PER_MINUTE) {
    recent.set(userId, times);
    return false;
  }
  times.push(nowMs);
  recent.set(userId, times);
  return true;
}

/** Test helper. */
export function resetLookupLimits(): void {
  recent.clear();
}

let chain: Promise<unknown> = Promise.resolve();

/** Runs big lookups (playlists, albums) one after another. */
export function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** Whether a looked-up video can be embedded, asking YouTube once. Unknown counts as yes. */
export async function checkEmbeddable(entry: LookupEntry): Promise<boolean> {
  if (entry.embeddable !== undefined) return entry.embeddable;
  try {
    entry.embeddable = service ? await service.embeddable(entry.track.videoId) : true;
  } catch (err) {
    logger.debug({ err, videoId: entry.track.videoId }, "embeddability check failed — assuming embeddable");
    entry.embeddable = true;
  }
  return entry.embeddable;
}
