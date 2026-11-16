// The guild's playlists on the site: the list every browser is sent, the one
// playlist this browser has open (its tracks are pushed as they change), and
// requests to the server, which each get a reply.
import { signal } from "@preact/signals";
import type { WSClient } from "./net";
import type { PlaylistDetail, PlaylistRequest, PlaylistSummary } from "./protocol";
import { showToast, wsClient } from "./store";

export const playlists = signal<PlaylistSummary[]>([]);
/** The open playlist's id; its tracks arrive in `openPlaylist`. */
export const openId = signal<number | null>(null);
export const openPlaylist = signal<PlaylistDetail | null>(null);
/** Whether this browser may change playlists and add tracks (a /join link with a Discord id). */
export const canEdit = signal(false);

const REQUEST_TIMEOUT_MS = 10_000;
let nextId = 1;
const pending = new Map<number, (reply: Reply) => void>();

export type Reply<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/** Sends a request; resolves with the server's reply, or a failure when it doesn't answer. */
export function request<T = unknown>(req: PlaylistRequest): Promise<Reply<T>> {
  const client = wsClient.value;
  if (!client) return Promise.resolve({ ok: false, error: "Not connected." });
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "The server didn't answer. Try again." });
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, (reply) => {
      window.clearTimeout(timer);
      resolve(reply as Reply<T>);
    });
    client.send({ type: "request", id, request: req });
  });
}

/** Runs a request and toasts its error; resolves with the data, or undefined when it failed. */
export async function act<T = unknown>(req: PlaylistRequest): Promise<{ data: T | undefined } | undefined> {
  const reply = await request<T>(req);
  if (!reply.ok) {
    showToast(reply.error, { durationMs: 4000 });
    return undefined;
  }
  return { data: reply.data };
}

/** Opens a playlist (null: back to the list). */
export async function open(id: number | null): Promise<void> {
  openId.value = id;
  if (id === null) {
    openPlaylist.value = null;
    void request({ kind: "openPlaylist", playlistId: null });
    return;
  }
  if (openPlaylist.value?.id !== id) openPlaylist.value = null;
  const reply = await request<PlaylistDetail>({ kind: "openPlaylist", playlistId: id });
  if (openId.value !== id) return; // opened another meanwhile
  if (reply.ok && reply.data) openPlaylist.value = reply.data;
  else {
    openId.value = null;
    openPlaylist.value = null;
    if (!reply.ok) showToast(reply.error, { durationMs: 4000 });
  }
}

/** Hooks a fresh connection up to playlist messages. */
export function attachPlaylists(client: WSClient): void {
  client.on("welcome", (msg) => {
    canEdit.value = msg.canEdit;
    // A reconnect starts unsubscribed: follow the open playlist again.
    if (openId.value !== null) void open(openId.value);
  });
  client.on("playlists", (msg) => {
    playlists.value = msg.playlists;
  });
  client.on("playlist", (msg) => {
    if (msg.playlist.id === openId.value) openPlaylist.value = msg.playlist;
  });
  client.on("playlistGone", (msg) => {
    if (msg.playlistId !== openId.value) return;
    openId.value = null;
    openPlaylist.value = null;
    showToast("That playlist was deleted.", { durationMs: 4000 });
  });
  client.on("reply", (msg) => {
    const { type: _t, id, ...reply } = msg;
    pending.get(id)?.(reply as Reply);
    pending.delete(id);
  });
}

export function resetPlaylists(): void {
  playlists.value = [];
  openId.value = null;
  openPlaylist.value = null;
  canEdit.value = false;
  for (const resolve of pending.values()) resolve({ ok: false, error: "Disconnected." });
  pending.clear();
}
