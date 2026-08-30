import { config } from "../config.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const PLAYLIST_TRACK_CAP = 50;

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artists: string[];
  durationMs: number;
}

export interface SpotifyCollection {
  name: string;
  tracks: SpotifyTrack[];
  totalTracks: number;
}

export interface ParsedSpotifyUrl {
  kind: "track" | "album" | "playlist";
  id: string;
}

let cachedToken: CachedToken | null = null;

export function isConfigured(): boolean {
  return !!(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET);
}

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;

export function parseSpotifyUrl(input: string): ParsedSpotifyUrl | null {
  const trimmed = input.trim();
  const uriMatch = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/.exec(trimmed);
  if (uriMatch) return { kind: uriMatch[1] as ParsedSpotifyUrl["kind"], id: uriMatch[2]! };
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "open.spotify.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // Path shapes: /track/<id>, /album/<id>, /playlist/<id>, or /intl-<lang>/track/<id>
    let kind: string | undefined;
    let id: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p === "track" || p === "album" || p === "playlist") {
        kind = p;
        id = parts[i + 1];
        break;
      }
    }
    if (!kind || !id) return null;
    if (!SPOTIFY_ID_RE.test(id)) return null;
    return { kind: kind as ParsedSpotifyUrl["kind"], id };
  } catch {
    return null;
  }
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
  if (!res.ok) throw new Error(`Spotify token ${res.status}: ${await res.text()}`);
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
    if (!retry.ok) throw new Error(`Spotify ${retry.status}: ${await retry.text()}`);
    return (await retry.json()) as T;
  }
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface TrackApi {
  id: string;
  name: string;
  duration_ms: number;
  artists: Array<{ name: string }>;
  is_local?: boolean;
}
interface AlbumApi {
  name: string;
  tracks: {
    items: TrackApi[];
    total: number;
  };
}
interface PlaylistItemApi {
  track: TrackApi | null;
}
interface PlaylistApi {
  name: string;
  tracks: {
    items: PlaylistItemApi[];
    total: number;
    next: string | null;
  };
}

function mapTrack(t: TrackApi): SpotifyTrack {
  return {
    id: t.id,
    title: t.name,
    artists: t.artists.map((a) => a.name).filter((s) => s.length > 0),
    durationMs: t.duration_ms,
  };
}

export async function getTrack(id: string): Promise<SpotifyTrack | null> {
  const res = await spotifyGet<TrackApi>(`/tracks/${id}`);
  if (!res.id) return null;
  return mapTrack(res);
}

export async function getAlbum(id: string): Promise<SpotifyCollection | null> {
  const res = await spotifyGet<AlbumApi>(`/albums/${id}`);
  if (!res.name) return null;
  const tracks = res.tracks.items
    .filter((t) => !t.is_local && t.id)
    .slice(0, PLAYLIST_TRACK_CAP)
    .map(mapTrack);
  return { name: res.name, tracks, totalTracks: res.tracks.total };
}

export async function getPlaylist(id: string): Promise<SpotifyCollection | null> {
  const res = await spotifyGet<PlaylistApi>(
    `/playlists/${id}?fields=name,tracks(total,next,items(track(id,name,duration_ms,is_local,artists(name))))`,
  );
  if (!res.name) return null;
  const tracks = res.tracks.items
    .map((it) => it.track)
    .filter((t): t is TrackApi => !!t && !t.is_local && !!t.id)
    .slice(0, PLAYLIST_TRACK_CAP)
    .map(mapTrack);
  return { name: res.name, tracks, totalTracks: res.tracks.total };
}
