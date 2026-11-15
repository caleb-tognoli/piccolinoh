import { Status } from "discord.js";
import { config } from "./config.js";
import { setDiscordProbe, startWatchdog } from "./health.js";
import { logger } from "./logger.js";
import { startServer } from "./watchtogether/server.js";
import { startBot } from "./bot/index.js";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException");
  process.exit(1);
});

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
