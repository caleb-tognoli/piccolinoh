import { config } from "../config.js";
import { getDb } from "./db/index.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const THISIS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface ThisIsCacheRow {
  playlist_url: string;
  artist_display: string;
  cached_at: number;
}

let cachedToken: CachedToken | null = null;

export function isConfigured(): boolean {
  return !!(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() + 60_000 < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  const creds = Buffer.from(
    `${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Spotify token ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

async function spotifyGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    cachedToken = null;
    const retryToken = await getAccessToken();
    const retry = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${retryToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Spotify ${retry.status}: ${await retry.text()}`);
    }
    return (await retry.json()) as T;
  }
  if (!res.ok) {
    throw new Error(`Spotify ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface SearchArtistsResponse {
  artists: { items: Array<{ id: string; name: string }> };
}

interface SearchPlaylistsResponse {
  playlists: {
    items: Array<{
      id: string;
      name: string;
      external_urls: { spotify: string };
      owner: { id: string };
    } | null>;
  };
}

function getThisIsFromCache(
  artistLower: string,
): { url: string; artistDisplayName: string } | null {
  const row = getDb()
    .prepare(
      "SELECT playlist_url, artist_display, cached_at FROM thisis_cache WHERE artist_lower = ?",
    )
    .get(artistLower) as ThisIsCacheRow | undefined;
  if (!row) return null;
  if (Date.now() - row.cached_at > THISIS_TTL_MS) return null;
  return { url: row.playlist_url, artistDisplayName: row.artist_display };
}

function saveThisIsToCache(
  artistLower: string,
  url: string,
  artistDisplay: string,
): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO thisis_cache (artist_lower, playlist_url, artist_display, cached_at) VALUES (?, ?, ?, ?)",
    )
    .run(artistLower, url, artistDisplay, Date.now());
}

export async function findThisIsPlaylistUrl(
  artistName: string,
): Promise<{ url: string; artistDisplayName: string } | null> {
  const artistLower = artistName.trim().toLowerCase();
  const cached = getThisIsFromCache(artistLower);
  if (cached) return cached;

  const artistSearch = await spotifyGet<SearchArtistsResponse>(
    `/search?type=artist&limit=1&q=${encodeURIComponent(artistName)}`,
  );
  const artist = artistSearch.artists.items[0];
  if (!artist) return null;

  const playlistQuery = `This Is ${artist.name}`;
  const playlistSearch = await spotifyGet<SearchPlaylistsResponse>(
    `/search?type=playlist&limit=10&q=${encodeURIComponent(playlistQuery)}`,
  );
  const match = playlistSearch.playlists.items.find(
    (p) => p && p.owner.id === "spotify" && p.name.toLowerCase() === playlistQuery.toLowerCase(),
  );
  if (!match) return null;

  const result = {
    url: match.external_urls.spotify,
    artistDisplayName: artist.name,
  };
  saveThisIsToCache(artistLower, result.url, result.artistDisplayName);
  return result;
}
