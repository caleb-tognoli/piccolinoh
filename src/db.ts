// The SQLite file that keeps rooms across restarts. Schema changes are
// append-only migrations: PRAGMA user_version counts how many have run.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  // 1: rooms and their live state. A room belongs to a guild; channel_id is
  // for rooms per channel later, so a guild's main room has none.
  `CREATE TABLE rooms (
     id         TEXT PRIMARY KEY,
     guild_id   TEXT NOT NULL,
     channel_id TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX rooms_guild_main ON rooms (guild_id) WHERE channel_id IS NULL;
   CREATE TABLE room_state (
     room_id    TEXT PRIMARY KEY REFERENCES rooms (id) ON DELETE CASCADE,
     state      TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  // 2: the play log, for stats. One row per track that became current in a
  // room; ended_at is NULL while it still is. User ids are Discord ids.
  `CREATE TABLE plays (
     id           INTEGER PRIMARY KEY,
     room_id      TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
     guild_id     TEXT NOT NULL,
     video_id     TEXT NOT NULL,
     title        TEXT NOT NULL,
     author       TEXT NOT NULL,
     duration_sec REAL NOT NULL,
     added_by     TEXT,
     started_at   INTEGER NOT NULL,
     ended_at     INTEGER,
     played_sec   REAL NOT NULL DEFAULT 0,
     outcome      TEXT CHECK (outcome IN ('finished', 'skipped', 'autoSkipped', 'interrupted')),
     ended_by     TEXT
   );
   CREATE INDEX plays_guild_started ON plays (guild_id, started_at);
   CREATE INDEX plays_open ON plays (room_id) WHERE ended_at IS NULL;
   CREATE TABLE play_listeners (
     play_id INTEGER NOT NULL REFERENCES plays (id) ON DELETE CASCADE,
     user_id TEXT NOT NULL,
     PRIMARY KEY (play_id, user_id)
   ) WITHOUT ROWID;
   CREATE INDEX play_listeners_user ON play_listeners (user_id);
   CREATE TABLE stats_optouts (
     guild_id TEXT NOT NULL,
     user_id  TEXT NOT NULL,
     PRIMARY KEY (guild_id, user_id)
   ) WITHOUT ROWID;`,
  // 3: playlists a guild keeps, frozen lists of videos anyone there can queue
  // or edit. name_key is the lowercased name, so names are unique ignoring
  // case. A play remembers the playlist it was queued from.
  `CREATE TABLE playlists (
     id         INTEGER PRIMARY KEY,
     guild_id   TEXT NOT NULL,
     name       TEXT NOT NULL,
     name_key   TEXT NOT NULL,
     created_by TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX playlists_guild_name ON playlists (guild_id, name_key);
   CREATE TABLE playlist_tracks (
     playlist_id  INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
     video_id     TEXT NOT NULL,
     position     INTEGER NOT NULL,
     title        TEXT NOT NULL,
     author       TEXT NOT NULL,
     duration_sec REAL NOT NULL,
     added_by     TEXT,
     added_at     INTEGER NOT NULL,
     PRIMARY KEY (playlist_id, video_id)
   ) WITHOUT ROWID;
   CREATE INDEX playlist_tracks_order ON playlist_tracks (playlist_id, position);
   ALTER TABLE plays ADD COLUMN playlist_id INTEGER REFERENCES playlists (id) ON DELETE SET NULL;`,
];

/** Opens (creating if needed) the database at `file`, or in memory for ":memory:", and migrates it. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version > MIGRATIONS.length) {
    throw new Error(`database schema v${version} is newer than this build (v${MIGRATIONS.length})`);
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
