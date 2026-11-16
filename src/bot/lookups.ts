// The bot's YouTube and Spotify lookups, handed to the site's Add boxes
// (src/watchtogether/lookups.ts). Same rules as /play.
import type { LookupService } from "../watchtogether/lookups.js";
import { parseYouTubeUrl, resolveInput } from "./resolver.js";
import { parseSpotifyUrl, spotifyEnabled } from "./spotify.js";
import { isEmbeddable, searchVideos } from "./youtube.js";

const SPOTIFY_LABELS = { album: "Spotify album", track: "Spotify track", playlist: "Spotify playlist" } as const;

export const botLookups: LookupService = {
  classify(input) {
    const query = input.trim();
    if (query.startsWith("spotify:") || /^https?:\/\/open\.spotify\.com\//.test(query)) {
      if (!spotifyEnabled()) return { kind: "unsupported", message: "Spotify links aren't enabled on this bot." };
      const ref = parseSpotifyUrl(query);
      if (!ref) return { kind: "unsupported", message: "Unrecognized Spotify link." };
      if (ref.kind === "playlist") {
        return { kind: "unsupported", message: "Spotify playlists aren't supported — paste an album or track link instead." };
      }
      return { kind: "collection", label: SPOTIFY_LABELS[ref.kind] };
    }
    const youtube = parseYouTubeUrl(query);
    if (youtube?.kind === "video") return { kind: "video" };
    if (youtube?.kind === "playlist") return { kind: "collection", label: "YouTube playlist" };
    if (/^https?:\/\//.test(query)) return { kind: "unsupported", message: "Only YouTube and Spotify links are supported." };
    return { kind: "search" };
  },
  search: (query, limit) => searchVideos(query, limit),
  async resolve(input) {
    const result = await resolveInput(input);
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      tracks: result.tracks,
      ...(result.playlistName ? { playlistName: result.playlistName } : {}),
      ...(result.dropped ? { dropped: result.dropped } : {}),
    };
  },
  embeddable: isEmbeddable,
};
