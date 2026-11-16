// The play log that server and personal stats are built from: one row per
// track that played in a room, with who added it, how long it actually played
// (paused time doesn't count), how it ended and who skipped it, plus which
// named people had the room open meanwhile. People who opt out (/privacy) are
// left out of all of it. Only runs while the store has a database open.
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db.js";
import { logger } from "../logger.js";
import { type CurrentTrack, onSessionChange, onTrackChange, type Session, type TrackEnd } from "./session.js";

interface OpenPlay {
  id: number;
  /** The session's `current` this row is about; a new object means a new play. */
  track: CurrentTrack;
  /** Played time banked so far, not counting the running stretch. */
  playedMs: number;
  /** When the running stretch began, while playing. */
  runningSince?: number;
  listeners: Set<string>;
}

let db: DatabaseSync | undefined;
let unsubscribe: (() => void)[] = [];
const open = new Map<Session, OpenPlay>();
/** `${guildId}:${userId}` of everyone who opted out. */
const optedOut = new Set<string>();
/** Discord user ids of the named browsers in a room; ws.ts provides it. */
let viewerSource: (session: Session) => string[] = () => [];

export function setViewerSource(fn: (session: Session) => string[]): void {
  viewerSource = fn;
}

export function openPlays(database: DatabaseSync): void {
  db = database;
  optedOut.clear();
  const rows = db.prepare("SELECT guild_id, user_id FROM stats_optouts").all() as { guild_id: string; user_id: string }[];
  for (const r of rows) optedOut.add(`${r.guild_id}:${r.user_id}`);
  unsubscribe = [onTrackChange(trackChanged), onSessionChange(syncRunning)];
}

/** Banks played time on open plays (when `save`), then lets go of the database. Open rows stay open. */
export function closePlays(save: boolean): void {
  if (db && save) {
    const now = Date.now();
    for (const play of open.values()) {
      bank(play, now);
      safely("bank played time", () =>
        db!.prepare("UPDATE plays SET played_sec = ? WHERE id = ?").run(play.playedMs / 1000, play.id),
      );
    }
  }
  for (const fn of unsubscribe) fn();
  unsubscribe = [];
  open.clear();
  db = undefined;
}

/** The open play row for the session's current track, to save with the room. */
export function currentPlayId(session: Session): number | undefined {
  const play = open.get(session);
  return play && play.track === session.current ? play.id : undefined;
}

/** A restored room: picks its current track's row back up, so the same play keeps counting. */
export function resumePlay(session: Session, playId: number): void {
  if (!db || !session.current) return;
  const row = db
    .prepare("SELECT played_sec FROM plays WHERE id = ? AND room_id = ? AND video_id = ? AND ended_at IS NULL")
    .get(playId, session.id, session.current.videoId) as { played_sec: number } | undefined;
  if (!row) return;
  const listeners = db.prepare("SELECT user_id FROM play_listeners WHERE play_id = ?").all(playId) as { user_id: string }[];
  open.set(session, {
    id: playId,
    track: session.current,
    playedMs: row.played_sec * 1000,
    listeners: new Set(listeners.map((l) => l.user_id)),
  });
}

/** Closes rows left open by a run that crashed or whose room didn't come back. Call after resumePlay. */
export function endUnclaimedPlays(): void {
  if (!db) return;
  const claimed = [...open.values()].map((p) => p.id);
  const { changes } = db
    .prepare(
      `UPDATE plays SET ended_at = started_at + CAST(played_sec * 1000 AS INTEGER), outcome = 'interrupted'
       WHERE ended_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))`,
    )
    .run(JSON.stringify(claimed));
  if (Number(changes) > 0) logger.info({ plays: Number(changes) }, "plays: closed plays left open");
}

/** A room is going away; its rows go with it (ON DELETE CASCADE). */
export function dropPlay(session: Session): void {
  open.delete(session);
}

/** A named person is in the room: they count as a listener of what's playing. */
export function recordListener(session: Session, userId: string): void {
  const play = open.get(session);
  if (!db || !play || play.track !== session.current) return;
  if (play.listeners.has(userId) || optedOut.has(`${session.guildId}:${userId}`)) return;
  play.listeners.add(userId);
  safely("record listener", () =>
    db!.prepare("INSERT OR IGNORE INTO play_listeners (play_id, user_id) VALUES (?, ?)").run(play.id, userId),
  );
}

export function isStatsOptedOut(guildId: string, userId: string): boolean {
  return optedOut.has(`${guildId}:${userId}`);
}

/** Opting out also erases what was already recorded about them in this server. */
export function setStatsOptOut(guildId: string, userId: string, out: boolean): void {
  const key = `${guildId}:${userId}`;
  if (out) optedOut.add(key);
  else optedOut.delete(key);
  if (!db) return;
  const database = db;
  if (!out) {
    database.prepare("DELETE FROM stats_optouts WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
    return;
  }
  transaction(database, () => {
    database.prepare("INSERT OR IGNORE INTO stats_optouts (guild_id, user_id) VALUES (?, ?)").run(guildId, userId);
    database
      .prepare("DELETE FROM play_listeners WHERE user_id = ? AND play_id IN (SELECT id FROM plays WHERE guild_id = ?)")
      .run(userId, guildId);
    database.prepare("UPDATE plays SET added_by = NULL WHERE guild_id = ? AND added_by = ?").run(guildId, userId);
    database.prepare("UPDATE plays SET ended_by = NULL WHERE guild_id = ? AND ended_by = ?").run(guildId, userId);
  });
  for (const [session, play] of open) if (session.guildId === guildId) play.listeners.delete(userId);
}

/** Someone's id for the log, or null when they opted out. */
function counted(guildId: string, userId: string | undefined): string | null {
  return userId && !optedOut.has(`${guildId}:${userId}`) ? userId : null;
}

function bank(play: OpenPlay, nowMs: number): void {
  if (play.runningSince === undefined) return;
  play.playedMs += Math.max(0, nowMs - play.runningSince);
  play.runningSince = undefined;
}

function trackChanged(
  session: Session,
  ended: { track: CurrentTrack; end: TrackEnd } | undefined,
  started: CurrentTrack | undefined,
): void {
  const now = Date.now();
  const play = open.get(session);
  if (ended && play && play.track === ended.track) {
    open.delete(session);
    bank(play, now);
    const byUserId = ended.end.how === "skipped" ? ended.end.byUserId : undefined;
    safely("end play", () =>
      db!
        .prepare("UPDATE plays SET ended_at = ?, played_sec = ?, outcome = ?, ended_by = ? WHERE id = ?")
        .run(now, play.playedMs / 1000, ended.end.how, counted(session.guildId, byUserId), play.id),
    );
  }
  if (started) start(session, started, now);
}

function start(session: Session, track: CurrentTrack, nowMs: number): void {
  const id = safely("start play", () =>
    Number(
      db!
        .prepare(
          `INSERT INTO plays (room_id, guild_id, video_id, title, author, duration_sec, added_by, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.guildId,
          track.videoId,
          track.title,
          track.author,
          track.durationSec,
          counted(session.guildId, track.addedBy?.userId),
          nowMs,
        ).lastInsertRowid,
    ),
  );
  if (id === undefined) return;
  open.set(session, {
    id,
    track,
    playedMs: 0,
    ...(track.pausedAtPositionSec == null ? { runningSince: nowMs } : {}),
    listeners: new Set(),
  });
  for (const userId of viewerSource(session)) recordListener(session, userId);
}

/** Starts or stops the running stretch when the current track is resumed or paused. */
function syncRunning(session: Session): void {
  const play = open.get(session);
  if (!play || play.track !== session.current) return;
  const playing = session.current.pausedAtPositionSec == null;
  if (playing && play.runningSince === undefined) play.runningSince = Date.now();
  else if (!playing) bank(play, Date.now());
}

/** The log must never break playback: a failed write is logged and skipped. */
function safely<T>(what: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    logger.error({ err }, `plays: failed to ${what}`);
    return undefined;
  }
}
