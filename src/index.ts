import { config } from "./config.js";
import { logger } from "./logger.js";
import { createClient } from "./client.js";
import { registerReady } from "./events/ready.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";

const client = createClient();

registerReady(client);
registerInteractionCreate(client);

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException");
  process.exit(1);
});

client.login(config.DISCORD_TOKEN).catch((err) => {
  logger.fatal({ err }, "login failed");
  process.exit(1);
});
