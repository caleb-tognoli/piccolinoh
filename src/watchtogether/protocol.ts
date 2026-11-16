import { z } from "zod";

// Browsers get transport controls, queue reordering and queue removal (with
// undo, which only restores a recently removed track), and can turn autoplay
// back on; turning autoplay off goes through the Discord bot. Named browsers
// (a /join link carrying a Discord id) can also add tracks (searches and links)
// and use the guild's playlists through requests, which get a reply; guests
// can only look at playlists.
const browserControlSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("play") }),
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("skip") }),
  z.object({ kind: z.literal("seek"), toSec: z.number().min(0) }),
  z.object({ kind: z.literal("remove"), index: z.number().int().min(0) }),
  z.object({ kind: z.literal("restore"), videoId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("reorder"), from: z.number().int().min(0), to: z.number().int().min(0) }),
  z.object({ kind: z.literal("autoplayOn") }),
]);

const id = z.number().int().min(1);
const videoId = z.string().min(1).max(64);
const index = z.number().int().min(0);
const name = z.string().min(1).max(200);

export const requestSchema = z.discriminatedUnion("kind", [
  /** Follow one playlist's tracks (pushed as `playlist` messages), or none with null. */
  z.object({ kind: z.literal("openPlaylist"), playlistId: id.nullable() }),
  z.object({ kind: z.literal("createPlaylist"), name }),
  z.object({ kind: z.literal("renamePlaylist"), playlistId: id, name }),
  z.object({ kind: z.literal("deletePlaylist"), playlistId: id }),
  z.object({ kind: z.literal("queuePlaylist"), playlistId: id, next: z.boolean(), shuffle: z.boolean() }),
  z.object({ kind: z.literal("queuePlaylistTrack"), playlistId: id, index, videoId, next: z.boolean() }),
  z.object({ kind: z.literal("movePlaylistTrack"), playlistId: id, from: index, to: index, videoId }),
  z.object({ kind: z.literal("removePlaylistTrack"), playlistId: id, index, videoId }),
  z.object({ kind: z.literal("restorePlaylistTrack"), playlistId: id, videoId }),
  /** Videos the room has (playing, queued or played), or this browser's recent lookups. */
  z.object({ kind: z.literal("addToPlaylist"), playlistId: id, videoIds: z.array(videoId).min(1).max(500) }),
  /** Which playlists already hold a video, for the "+ playlist" picker. */
  z.object({ kind: z.literal("playlistsWith"), videoId }),
  /** Search results or a link's video; a playlist or album link is only named until added. */
  z.object({ kind: z.literal("lookup"), query: z.string().trim().min(1).max(300) }),
  /** Queues a video this browser looked up. */
  z.object({ kind: z.literal("enqueueVideo"), videoId, next: z.boolean() }),
  /** Resolves a playlist or album link and queues it, or adds it to a playlist. */
  z.object({
    kind: z.literal("addCollection"),
    query: z.string().trim().min(1).max(300),
    next: z.boolean(),
    /** Queue it in random order (ignored when adding to a playlist). */
    shuffle: z.boolean().optional(),
    playlistId: id.nullable(),
  }),
]);
export type PlaylistRequest = z.infer<typeof requestSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    sessionId: z.string().min(1),
    joinToken: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("ping"), t0: z.number() }),
  z.object({ type: z.literal("control"), action: browserControlSchema }),
  z.object({ type: z.literal("request"), id: z.number().int(), request: requestSchema }),
  z.object({
    type: z.literal("playbackError"),
    videoId: z.string().min(1).max(64),
    code: z.number().int(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
