import path from "node:path";
import { Status } from "discord.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";
import { setDiscordProbe, startWatchdog } from "./health.js";
import { logger } from "./logger.js";
import { setLookupService } from "./watchtogether/lookups.js";
import { startServer } from "./watchtogether/server.js";
import { closeStore, openStore } from "./watchtogether/store.js";
import { startBot } from "./bot/index.js";
import { botLookups } from "./bot/lookups.js";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException");
  process.exit(1);
});

try {
  const db = openDatabase(path.join(config.DATA_DIR, "piccolinoh.db"));
  openStore(db);
  // Every way out goes through process.exit (signals included, below), and
  // SQLite writes synchronously, so rooms are saved however the process ends.
  process.on("exit", () => {
    closeStore();
    db.close();
  });
} catch (err) {
  logger.fatal({ err }, "failed to open the database");
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    process.exit(0);
  });
}

// The site's Add boxes find videos the way /play does.
setLookupService(botLookups);
try {
  await startServer(config.HTTP_PORT);
} catch (err) {
  logger.fatal({ err }, "web server failed to start");
  process.exit(1);
}

startWatchdog();
try {
  const client = await startBot();
  setDiscordProbe(() => client.isReady() && client.ws.shards.every((shard) => shard.status === Status.Ready));
} catch (err) {
  logger.fatal({ err }, "discord bot failed to start");
  process.exit(1);
}
