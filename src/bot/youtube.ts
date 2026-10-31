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
