// Rooms by id and by guild. With a database open (openStore), every room and
// its live state is saved there and reloaded on the next start, so room ids
// and join links survive restarts. Without one (tests) rooms live in memory only.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { transaction } from "../db.js";
import { logger } from "../logger.js";
import { closePlays, currentPlayId, dropPlay, endUnclaimedPlays, openPlays, resumePlay } from "./plays.js";
import { createSession, onSessionChange, type Session } from "./session.js";
import { derivePosition } from "./timeline.js";

const sessionsById = new Map<string, Session>();
const sessionsByGuild = new Map<string, Session>();

/** How long after a change a room's state is written, so bursts of changes save once. */
export const SAVE_DELAY_MS = 1_000;

let db: DatabaseSync | undefined;
let unsubscribe: (() => void) | undefined;
const dirty = new Set<Session>();
let saveTimer: NodeJS.Timeout | undefined;

const trackSchema = z.object({
  videoId: z.string().min(1),
  title: z.string(),
  author: z.string(),
  durationSec: z.number().min(0),
  startSec: z.number().min(0).optional(),
  addedBy: z.object({ userId: z.string().min(1), name: z.string() }).optional(),
});

/** What is kept of a room between runs. Playback comes back paused where it was. */
const savedStateSchema = z.object({
  epoch: z.number().int().min(0),
  autoplay: z.boolean(),
  current: trackSchema
    .extend({ positionSec: z.number().min(0), /** Its open row in the play log. */ playId: z.number().int().optional() })
    .optional(),
  queue: z.array(trackSchema),
  history: z.array(trackSchema),
});
type SavedState = z.infer<typeof savedStateSchema>;

export function getSession(id: string): Session | undefined {
  return sessionsById.get(id);
}

export function getOrCreateSessionForGuild(guildId: string): Session {
  let session = sessionsByGuild.get(guildId);
  if (!session) {
    session = createSession(guildId);
    db?.prepare("INSERT INTO rooms (id, guild_id, created_at) VALUES (?, ?, ?)").run(session.id, guildId, Date.now());
    add(session);
  }
  return session;
}

/** Browsers connected across every session. */
export function connectedBrowsers(): number {
  let count = 0;
  for (const session of sessionsById.values()) count += session.clients.size;
  return count;
}

/** Loads every saved room from `database` and saves rooms there from now on. */
export function openStore(database: DatabaseSync): void {
  if (db) throw new Error("store already open");
  db = database;
  openPlays(db);
  const rows = db
    .prepare(
      `SELECT r.id, r.guild_id, s.state FROM rooms r
       LEFT JOIN room_state s ON s.room_id = r.id
       WHERE r.channel_id IS NULL`,
    )
    .all() as { id: string; guild_id: string; state: string | null }[];
  for (const row of rows) add(restore(row.id, row.guild_id, row.state));
  endUnclaimedPlays();
  unsubscribe = onSessionChange(markDirty);
  logger.info({ rooms: rows.length }, "store: rooms loaded");
}

/** Saves every room (positions included) and lets go of the database and all rooms. */
export function closeStore(): void {
  if (!db) return;
  save([...sessionsById.values()]);
  closePlays(true);
  detach();
  drop();
}

/** The bot left `guildId`: closes its room and deletes everything kept about it, play log included. */
export function forgetGuild(guildId: string): void {
  const session = sessionsByGuild.get(guildId);
  if (session) {
    clearTimeout(session.advanceTimer);
    for (const ws of session.clients) ws.close(1000, "room closed");
    sessionsById.delete(session.id);
    sessionsByGuild.delete(guildId);
    dirty.delete(session);
    dropPlay(session);
  }
  db?.prepare("DELETE FROM rooms WHERE guild_id = ?").run(guildId);
  db?.prepare("DELETE FROM stats_optouts WHERE guild_id = ?").run(guildId);
}

/** Test helper: drops every session, stopping timers and closing sockets, without saving. */
export function resetStore(): void {
  for (const session of sessionsById.values()) {
    for (const ws of session.clients) ws.close(1000, "session destroyed");
  }
  closePlays(false);
  detach();
  drop();
}

function add(session: Session): void {
  sessionsById.set(session.id, session);
  sessionsByGuild.set(session.guildId, session);
}

function detach(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  dirty.clear();
  db = undefined;
}

function drop(): void {
  for (const session of sessionsById.values()) clearTimeout(session.advanceTimer);
  sessionsById.clear();
  sessionsByGuild.clear();
}

function markDirty(session: Session): void {
  if (!db || sessionsById.get(session.id) !== session) return;
  dirty.add(session);
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    const sessions = [...dirty];
    dirty.clear();
    save(sessions);
  }, SAVE_DELAY_MS);
}

function save(sessions: Session[]): void {
  if (!db || sessions.length === 0) return;
  const upsert = db.prepare(
    `INSERT INTO room_state (room_id, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  try {
    transaction(db, () => {
      for (const session of sessions) upsert.run(session.id, JSON.stringify(toSaved(session, now)), now);
    });
  } catch (err) {
    logger.error({ err, rooms: sessions.length }, "store: failed to save rooms");
  }
}

function toSaved(session: Session, nowMs: number): SavedState {
  const { epoch, autoplay, queue, history, current } = session;
  if (!current) return { epoch, autoplay, queue, history };
  const { startedAtServerMs: _s, pausedAtPositionSec: _p, ...track } = current;
  const positionSec = Math.min(Math.max(0, derivePosition(session, nowMs)), current.durationSec);
  const playId = currentPlayId(session);
  return { epoch, autoplay, queue, history, current: { ...track, positionSec, ...(playId ? { playId } : {}) } };
}

function restore(id: string, guildId: string, json: string | null): Session {
  const session = createSession(guildId, id);
  if (json == null) return session;
  let saved: SavedState;
  try {
    saved = savedStateSchema.parse(JSON.parse(json));
  } catch (err) {
    logger.warn({ err, roomId: id, guildId }, "store: saved room state unreadable, starting it empty");
    return session;
  }
  // A new epoch, so browsers still holding the last run's state drop it.
  session.epoch = saved.epoch + 1;
  session.autoplay = saved.autoplay;
  session.queue = saved.queue;
  session.history = saved.history;
  if (saved.current) {
    const { positionSec, playId, ...track } = saved.current;
    session.current = { ...track, startedAtServerMs: Date.now() - positionSec * 1000, pausedAtPositionSec: positionSec };
    if (playId !== undefined) resumePlay(session, playId);
  }
  return session;
}
