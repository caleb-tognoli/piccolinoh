// Env vars src/config.ts requires, so tests can import modules that load it.
// dotenv doesn't overwrite existing values, so a developer's .env still wins.
process.env["DISCORD_TOKEN"] ??= "test-token";
process.env["DISCORD_GUILD_ID"] ??= "222222222222222222";
process.env["JOIN_TOKEN_SECRET"] ??= "test-secret-that-is-at-least-32-characters-long";
process.env["LOG_LEVEL"] ??= "warn";
