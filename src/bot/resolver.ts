// Turns /play input (YouTube URL, text search, Spotify link) into playable
// YouTube tracks. Lavalink is used purely as a metadata/search resolver.
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Track } from "../watchtogether/session.js";
import { getAlbum, getTrack, parseSpotifyUrl, spotifyEnabled, type SpotifyTrack } from "./spotify.js";

const VIDEO_ID_RE = /^[\w-]{11}$/;
const SPOTIFY_TRANSLATION_CONCURRENCY = 5;

export type ResolveResult =
  | { ok: true; tracks: Track[]; playlistName?: string }
  | { ok: false; message: string };

interface LavalinkTrack {
  info: { identifier: string; title: string; author: string; length: number; isStream: boolean };
}

type LoadTracksResponse =
  | { loadType: "track"; data: LavalinkTrack }
  | { loadType: "search"; data: LavalinkTrack[] }
  | { loadType: "playlist"; data: { info: { name: string }; tracks: LavalinkTrack[] } }
  | { loadType: "empty"; data: null }
  | { loadType: "error"; data: { message: string } };

const fail = (message: string): ResolveResult => ({ ok: false, message });

async function loadTracks(identifier: string): Promise<{ tracks: Track[]; playlistName?: string }> {
  const url = new URL("/v4/loadtracks", config.LAVALINK_URL);
  url.searchParams.set("identifier", identifier);
  const res = await fetch(url, { headers: { Authorization: config.LAVALINK_PASSWORD } });
  if (!res.ok) throw new Error(`loadtracks ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as LoadTracksResponse;

  let raw: LavalinkTrack[] = [];
  let playlistName: string | undefined;
  switch (body.loadType) {
    case "error":
      throw new Error(`loadtracks error: ${body.data.message}`);
    case "track":
      raw = [body.data];
      break;
    case "search":
      raw = body.data.slice(0, 1);
      break;
    case "playlist":
      raw = body.data.tracks;
      playlistName = body.data.info.name;
      break;
  }
  const tracks = raw
    .filter((t) => !t.info.isStream && t.info.identifier)
    .map(({ info }) => ({
      videoId: info.identifier,
      title: info.title,
      author: info.author,
      durationSec: Math.round(info.length / 1000),
    }));
  return { tracks, playlistName };
}

/** A single video link (watch?v=, youtu.be, shorts) -> its id, so `&list=` doesn't expand to a playlist. */
export function youtubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const id =
    host === "youtu.be"
      ? parts[0]
      : host === "youtube.com"
        ? (url.searchParams.get("v") ?? (parts[0] === "shorts" ? parts[1] : undefined))
        : undefined;
  return id && VIDEO_ID_RE.test(id) ? id : null;
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

/** Finds the YouTube video for a Spotify track, keeping Spotify's title/artist for display. */
async function translateSpotifyTrack(t: SpotifyTrack): Promise<Track | null> {
  const { tracks } = await loadTracks(`ytsearch:${[t.artist, t.title].filter(Boolean).join(" ")}`);
  const hit = tracks[0];
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

  const translated = await mapConcurrent(source.tracks, SPOTIFY_TRANSLATION_CONCURRENCY, translateSpotifyTrack);
  const tracks = translated.filter((t): t is Track => t !== null);
  return tracks.length > 0 ? { ok: true, tracks, playlistName: source.name } : fail("No results.");
}

export async function resolveInput(input: string): Promise<ResolveResult> {
  const query = input.trim();
  try {
    if (query.startsWith("spotify:") || /^https?:\/\/open\.spotify\.com\//.test(query)) {
      return await resolveSpotify(query);
    }
    const videoId = youtubeVideoId(query);
    const identifier = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : /^https?:\/\//.test(query)
        ? query
        : `ytsearch:${query}`;
    const { tracks, playlistName } = await loadTracks(identifier);
    return tracks.length > 0 ? { ok: true, tracks, playlistName } : fail("No results.");
  } catch (err) {
    logger.error({ err, input }, "resolveInput failed");
    return fail(`Error: ${(err as Error).message}`);
  }
}
