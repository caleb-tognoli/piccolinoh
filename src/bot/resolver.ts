// Turns /play input (YouTube link, Spotify link, or search text) into playable
// YouTube tracks.
import { logger } from "../logger.js";
import type { Track } from "../watchtogether/session.js";
import { getAlbum, getTrack, parseSpotifyUrl, spotifyEnabled, type SpotifyTrack } from "./spotify.js";
import { getPlaylist, getVideo, isEmbeddable, searchSongs, searchVideos } from "./youtube.js";

const VIDEO_ID_RE = /^[\w-]{11}$/;
const SPOTIFY_TRANSLATION_CONCURRENCY = 5;
/** How many search results to try before giving up on finding an embeddable one. */
const EMBED_CANDIDATES = 3;
/** A YouTube upload within this many seconds of the Spotify track counts as the same recording. */
const DURATION_TOLERANCE_SEC = 5;

export type ResolveResult =
  | { ok: true; tracks: Track[]; playlistName?: string }
  | { ok: false; message: string };

const fail = (message: string): ResolveResult => ({ ok: false, message });

export type YouTubeRef = { kind: "video"; id: string } | { kind: "playlist"; id: string };

/**
 * Recognizes YouTube links. A watch link that also carries `&list=` is treated
 * as the single video; only a bare playlist link queues the whole playlist.
 */
export function parseYouTubeUrl(input: string): YouTubeRef | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let videoId: string | null | undefined;
  if (host === "youtu.be") videoId = parts[0];
  else if (host === "youtube.com") videoId = url.searchParams.get("v") ?? (parts[0] === "shorts" ? parts[1] : null);
  else return null;

  if (videoId && VIDEO_ID_RE.test(videoId)) return { kind: "video", id: videoId };
  const listId = url.searchParams.get("list");
  return listId ? { kind: "playlist", id: listId } : null;
}

const isClose = (t: Track, targetSec: number) => Math.abs(t.durationSec - targetSec) <= DURATION_TOLERANCE_SEC;

/** Candidates whose length matches the target first, otherwise keeping YouTube's order. */
export function rankByDuration(candidates: Track[], targetSec: number): Track[] {
  return [...candidates.filter((t) => isClose(t, targetSec)), ...candidates.filter((t) => !isClose(t, targetSec))];
}

/** First candidate YouTube doesn't flag as unembeddable (only those can play on the site). */
async function firstEmbeddable(candidates: Track[]): Promise<Track | undefined> {
  for (const candidate of candidates.slice(0, EMBED_CANDIDATES)) {
    if (await isEmbeddable(candidate.videoId)) return candidate;
  }
  return undefined;
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function resolveVideo(videoId: string): Promise<ResolveResult> {
  try {
    const { track, embeddable } = await getVideo(videoId);
    if (embeddable === false) return fail("That video's owner doesn't allow playing it on other sites.");
    if (track) return { ok: true, tracks: [track] };
  } catch (err) {
    logger.warn({ err, videoId }, "video lookup failed — trying search");
  }
  // The player endpoint can refuse metadata (bot checks); search usually still finds the video.
  const hit = (await searchVideos(videoId, 10)).find((t) => t.videoId === videoId);
  return hit ? { ok: true, tracks: [hit] } : fail("Couldn't find that video (live streams aren't supported).");
}

async function resolveSearch(query: string): Promise<ResolveResult> {
  const results = await searchVideos(query);
  if (results.length === 0) return fail("No results.");
  const hit = await firstEmbeddable(results);
  return hit ? { ok: true, tracks: [hit] } : fail("The top results can't be played on other sites.");
}

/**
 * Finds the YouTube upload of a Spotify track: YouTube Music songs first, regular
 * videos if no song has the right length. Keeps Spotify's title/artist for display.
 */
async function translateSpotifyTrack(t: SpotifyTrack): Promise<Track | null> {
  const query = [t.artist, t.title].filter(Boolean).join(" ");
  const songs = await searchSongs(query).catch((err: unknown) => {
    logger.warn({ err, query }, "YouTube Music search failed — falling back to videos");
    return [];
  });
  let candidates = rankByDuration(songs, t.durationSec);
  if (!candidates[0] || !isClose(candidates[0], t.durationSec)) {
    candidates = rankByDuration([...candidates, ...(await searchVideos(query))], t.durationSec);
  }
  const hit = await firstEmbeddable(candidates);
  return hit ? { ...hit, title: t.title, author: t.artist ?? hit.author } : null;
}

async function resolveSpotify(input: string): Promise<ResolveResult> {
  if (!spotifyEnabled()) return fail("Spotify links aren't enabled on this bot.");
  const ref = parseSpotifyUrl(input);
  if (!ref) return fail("Unrecognized Spotify link.");
  if (ref.kind === "playlist") {
    // Client Credentials apps can't read playlist contents (needs user OAuth).
    return fail("Spotify playlists aren't supported — paste an album or track link instead.");
  }

  const source =
    ref.kind === "track"
      ? await getTrack(ref.id).then((t) => (t ? { name: undefined, tracks: [t] } : null))
      : await getAlbum(ref.id);
  if (!source) return fail("No results.");

  const translated = await mapConcurrent(source.tracks, SPOTIFY_TRANSLATION_CONCURRENCY, (t) =>
    translateSpotifyTrack(t).catch((err: unknown) => {
      logger.warn({ err, title: t.title }, "couldn't match Spotify track");
      return null;
    }),
  );
  const tracks = translated.filter((t): t is Track => t !== null);
  return tracks.length > 0 ? { ok: true, tracks, playlistName: source.name } : fail("No results.");
}

export async function resolveInput(input: string): Promise<ResolveResult> {
  const query = input.trim();
  try {
    if (query.startsWith("spotify:") || /^https?:\/\/open\.spotify\.com\//.test(query)) {
      return await resolveSpotify(query);
    }
    const youtube = parseYouTubeUrl(query);
    if (youtube?.kind === "video") return await resolveVideo(youtube.id);
    if (youtube?.kind === "playlist") {
      const { name, tracks } = await getPlaylist(youtube.id);
      return tracks.length > 0 ? { ok: true, tracks, playlistName: name } : fail("That playlist has no playable videos.");
    }
    if (/^https?:\/\//.test(query)) return fail("Only YouTube and Spotify links are supported.");
    return await resolveSearch(query);
  } catch (err) {
    logger.error({ err, input }, "resolveInput failed");
    return fail(`Error: ${(err as Error).message}`);
  }
}
