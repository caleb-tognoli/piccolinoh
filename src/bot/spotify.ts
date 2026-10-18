// Spotify Web API via Client Credentials — metadata only. Tracks are played by
// searching YouTube for "<artist> <title>" (see resolver.ts).
import { config } from "../config.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const ALBUM_TRACK_CAP = 50;
const SPOTIFY_ID = "[A-Za-z0-9]{22}";

export interface SpotifyRef {
  kind: "track" | "album" | "playlist";
  id: string;
}

export interface SpotifyTrack {
  title: string;
  artist?: string;
}

interface TrackApi {
  id: string | null;
  name: string;
  artists: { name: string }[];
  is_local?: boolean;
}

export function spotifyEnabled(): boolean {
  return !!(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET);
}

/** Accepts open.spotify.com links (optionally with an /intl-xx/ prefix) and spotify: URIs. */
export function parseSpotifyUrl(input: string): SpotifyRef | null {
  const trimmed = input.trim();
  const match =
    new RegExp(`^spotify:(track|album|playlist):(${SPOTIFY_ID})$`).exec(trimmed) ??
    new RegExp(
      `^https?://open\\.spotify\\.com/(?:intl-[\\w-]+/)?(track|album|playlist)/(${SPOTIFY_ID})(?:[/?#]|$)`,
    ).exec(trimmed);
  return match ? { kind: match[1] as SpotifyRef["kind"], id: match[2]! } : null;
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && Date.now() + 60_000 < token.expiresAt) return token.value;
  const creds = Buffer.from(`${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds.toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

/** GET an API path; null on 404. Retries once with a fresh token on 401. */
async function api<T>(path: string, retried = false): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 401 && !retried) {
    token = null;
    return api(path, true);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function toTrack(t: TrackApi): SpotifyTrack {
  return { title: t.name, artist: t.artists.find((a) => a.name)?.name };
}

export async function getTrack(id: string): Promise<SpotifyTrack | null> {
  const res = await api<TrackApi>(`/tracks/${id}`);
  return res?.id ? toTrack(res) : null;
}

export async function getAlbum(id: string): Promise<{ name: string; tracks: SpotifyTrack[] } | null> {
  const res = await api<{ name: string; tracks?: { items: (TrackApi | null)[] } }>(`/albums/${id}`);
  if (!res?.name || !res.tracks?.items) return null;
  const tracks = res.tracks.items
    .filter((t): t is TrackApi => !!t?.id && !t.is_local)
    .slice(0, ALBUM_TRACK_CAP)
    .map(toTrack);
  return { name: res.name, tracks };
}
