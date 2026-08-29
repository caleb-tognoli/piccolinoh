export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS query_cache (
  query TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS video_cache (
  video_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  skipmode TEXT NOT NULL DEFAULT 'anyone',
  vote_threshold REAL NOT NULL DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS thisis_cache (
  artist_lower TEXT PRIMARY KEY,
  playlist_url TEXT NOT NULL,
  artist_display TEXT NOT NULL,
  cached_at INTEGER NOT NULL
);
`;
