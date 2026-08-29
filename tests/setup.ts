// Populate env vars that src/config.ts requires, so tests can import
// modules that transitively load config.ts (e.g. logger, control) without
// blowing up when the developer's .env lacks the newer Phase 3 keys.
// dotenv (imported by config.ts) does not overwrite existing values, so
// the developer's real .env still wins when tests are run interactively.
process.env["DISCORD_TOKEN"] ??= "test-token";
process.env["DISCORD_CLIENT_ID"] ??= "111111111111111111";
process.env["DISCORD_GUILD_ID"] ??= "222222222222222222";
process.env["YOUTUBE_API_KEY"] ??= "test-key";
process.env["HTTP_PORT"] ??= "3000";
process.env["PUBLIC_BASE_URL"] ??= "http://localhost:3000";
process.env["SQLITE_PATH"] ??= ":memory:";
