import { config } from "./config.js";
import { logger } from "./logger.js";
import { createClient } from "./client.js";
import { registerReady } from "./events/ready.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { attachShoukaku, awaitShoukakuReady } from "./lavalink.js";

const client = createClient();
attachShoukaku(client);

registerReady(client);
registerInteractionCreate(client);

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException");
  process.exit(1);
});

try {
  await client.login(config.DISCORD_TOKEN);
} catch (err) {
  logger.fatal({ err }, "login failed");
  process.exit(1);
}

try {
  await awaitShoukakuReady(client, 10_000);
} catch (err) {
  logger.fatal({ err }, "lavalink readiness gate failed");
  process.exit(1);
}
