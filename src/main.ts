import { config } from "./config.js";
import { logger } from "./logger.js";
import { startServer } from "./watchtogether/index.js";
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
  logger.fatal({ err }, "watchtogether server failed to start");
  process.exit(1);
}

try {
  await startBot();
} catch (err) {
  logger.fatal({ err }, "discord bot failed to start");
  process.exit(1);
}
