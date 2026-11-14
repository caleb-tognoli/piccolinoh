// YouTube lookups through youtubei.js (YouTube's internal "InnerTube" API).
// Metadata only: we never fetch streams, so the JS player isn't loaded.
import { Innertube, YTNodes, type Helpers } from "youtubei.js";
import { logger } from "../logger.js";
import type { Track } from "../watchtogether/session.js";

const PLAYLIST_CAP = 200;

let client: Promise<Innertube> | null = null;

/** Lazily creates one shared session; a failed lookup drops it so the next one starts fresh. */
async function withClient<T>(fn: (yt: Innertube) => Promise<T>): Promise<T> {
  client ??= Innertube.create({ retrieve_player: false });
  try {
    return await fn(await client);
  } catch (err) {
    client = null;
    throw err;
  }
}

function track(videoId: string | undefined, title: string, author: string, durationSec: number): Track | null {
  // No duration means live, upcoming or a non-video item — nothing we can schedule.
  if (!videoId || !(durationSec > 0)) return null;
  return { videoId, title, author, durationSec };
}

/** Normalizes the various video-ish nodes YouTube returns in search results and playlists. */
function toTrack(node: Helpers.YTNode): Track | null {
  if (node.is(YTNodes.Video)) {
    if (node.is_live || node.is_upcoming) return null;
    return track(node.video_id, node.title.toString(), node.author.name, node.duration.seconds);
  }
  if (node.is(YTNodes.PlaylistVideo)) {
    if (!node.is_playable || node.is_live) return null;
    return track(node.id, node.title.toString(), node.author.name, node.duration.seconds);
  }
  if (node.is(YTNodes.LockupView)) {
    if (node.content_type !== "VIDEO") return null;
    const author = node.metadata?.metadata?.metadata_rows[0]?.metadata_parts?.[0]?.text?.toString();
    return track(node.content_id, node.metadata?.title?.toString() ?? "", author ?? "", node.duration.seconds);
  }
  if (node.is(YTNodes.MusicResponsiveListItem)) {
    const artists = (node.artists ?? node.authors ?? []).map((a) => a.name).join(", ");
    return track(node.id, node.title ?? "", artists, node.duration?.seconds ?? 0);
  }
  return null;
}

function tracks(nodes: Iterable<Helpers.YTNode>, limit: number): Track[] {
  const out: Track[] = [];
  for (const node of nodes) {
    const t = toTrack(node);
    if (t) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export function searchVideos(query: string, limit = 5): Promise<Track[]> {
  return withClient(async (yt) => tracks((await yt.search(query, { type: "video" })).videos, limit));
}

/** YouTube Music "Songs" results — official audio, best for matching a known song. */
export function searchSongs(query: string, limit = 5): Promise<Track[]> {
  return withClient(async (yt) => {
    const results = await yt.music.search(query, { type: "song" });
    return tracks(results.songs?.contents ?? [], limit);
  });
}

export function getPlaylist(listId: string): Promise<{ name: string; tracks: Track[] }> {
  return withClient(async (yt) => {
    let page = await yt.getPlaylist(listId);
    const name = page.info.title ?? "Playlist";
    const out = tracks(page.items, PLAYLIST_CAP);
    while (out.length < PLAYLIST_CAP && page.has_continuation) {
      page = await page.getContinuation();
      out.push(...tracks(page.items, PLAYLIST_CAP - out.length));
    }
    return { name, tracks: out };
  });
}

/** "883M plays" → 883e6; 0 when the label is missing or unreadable. */
export function parsePlays(label: string | undefined): number {
  const m = /([\d.,]+)\s*([KMB])?\s*plays?/i.exec(label ?? "");
  if (!m) return 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Number(m[1]!.replace(/,/g, "")) * scale;
}

/** How many of an artist's newest releases to pull, and how many tracks from each. */
const LATEST_RELEASES = 2;
const TRACKS_PER_RELEASE = 3;

export interface ArtistCatalog {
  name: string;
  /** YouTube Music's "Top songs" for the artist: current popularity, so new hits rank high. */
  topSongs: Track[];
  /** Most-played tracks of the newest releases from this or last year, newest release first. */
  latest: Track[];
}

/** Album / single tracks often have no artist column; fill in the page's artist. */
function withAuthor(t: Track, artist: string): Track {
  return t.author ? t : { ...t, author: artist };
}

/**
 * The release's most-played tracks. Tracks crediting someone else are dropped, which
 * also keeps compilations from an "Appears on" shelf down to the artist's own song.
 */
async function releaseTracks(yt: Innertube, albumId: string, artist: string): Promise<Track[]> {
  const album = await yt.music.getAlbum(albumId);
  const ranked = album.contents
    .map((node) => ({ node, plays: parsePlays(node.flex_columns.map((c) => c.title.toString()).join(" ")) }))
    .sort((a, b) => b.plays - a.plays); // stable: unknown plays keep the album order
  const own = tracks(
    ranked.map((r) => r.node),
    PLAYLIST_CAP,
  ).filter((t) => !t.author || t.author.toLowerCase().includes(artist.toLowerCase()));
  // A single padded with "(Acoustic Version)" / "(Sped Up)" variants should add one song, not three.
  const seen = new Set<string>();
  const picked = own.filter((t) => {
    const base = baseTitle(t.title);
    return !seen.has(base) && !!seen.add(base);
  });
  return picked.slice(0, TRACKS_PER_RELEASE).map((t) => withAuthor(t, artist));
}

/** "Patient Zero (Piano Version)" / "Patient Zero - Live" → "patient zero". */
export function baseTitle(title: string): string {
  return title
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .trim()
    .toLowerCase() || title.toLowerCase();
}

/** Finds an artist on YouTube Music and reads their top songs and newest releases. */
export function getArtistCatalog(query: string): Promise<ArtistCatalog | null> {
  return withClient(async (yt) => {
    const search = await yt.music.search(query, { type: "artist" });
    const hit = search.artists?.contents.find((a) => a.id && a.item_type === "artist");
    if (!hit?.id) return null;
    const page = await yt.music.getArtist(hit.id);
    const name = page.header?.title?.toString() || hit.name || query;

    // Matched by shape, not by its (localized) "Top songs" title: the only list shelf
    // on an artist page, linking to the full playlist.
    const shelf = page.sections.find((s) => s.is(YTNodes.MusicShelf) && s.endpoint);
    let topSongs: Track[] = [];
    if (shelf?.is(YTNodes.MusicShelf)) {
      const full = await shelf.endpoint!.call(yt.actions, { client: "YTMUSIC", parse: true });
      const list = full.contents_memo?.getType(YTNodes.MusicPlaylistShelf)?.[0]?.contents ?? shelf.contents;
      topSongs = tracks(list, PLAYLIST_CAP).map((t) => withAuthor(t, name));
    }

    const minYear = new Date().getFullYear() - 1;
    const releases = page.sections
      .flatMap((s) => (s.is(YTNodes.MusicCarouselShelf) ? s.contents.filterType(YTNodes.MusicTwoRowItem) : []))
      .filter((r) => r.item_type === "album" && r.id && Number(r.year) >= minYear)
      .sort((a, b) => Number(b.year) - Number(a.year)) // stable: carousels list newest first
      .slice(0, LATEST_RELEASES);
    const latest: Track[] = [];
    for (const release of releases) {
      try {
        latest.push(...(await releaseTracks(yt, release.id!, name)));
      } catch (err) {
        logger.warn({ err, release: release.id }, "couldn't read release tracks");
      }
    }
    return { name, topSongs, latest };
  });
}

/**
 * Looks up one video. `embeddable` is false only when YouTube clearly says so;
 * if the player endpoint refuses us (e.g. a bot check) it stays unknown (null).
 */
export function getVideo(videoId: string): Promise<{ track: Track | null; embeddable: boolean | null }> {
  return withClient(async (yt) => {
    const info = await yt.getBasicInfo(videoId);
    const { title, author, duration, is_live } = info.basic_info;
    const ok = info.playability_status?.status === "OK";
    return {
      track: is_live ? null : track(videoId, title ?? "", author ?? "", duration ?? 0),
      embeddable: ok ? info.playability_status!.embeddable : null,
    };
  });
}

/** Whether a video can play in the embedded player; unknown counts as yes. */
export async function isEmbeddable(videoId: string): Promise<boolean> {
  try {
    return (await getVideo(videoId)).embeddable !== false;
  } catch (err) {
    logger.debug({ err, videoId }, "embeddability check failed — assuming embeddable");
    return true;
  }
}
