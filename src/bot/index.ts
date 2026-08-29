import type { Client } from "discord.js";
import { config } from "../config.js";
import { createClient } from "./client.js";
import { openDb } from "./db/index.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { registerReady } from "./events/ready.js";

export async function startBot(): Promise<Client> {
  openDb(config.SQLITE_PATH);
  const client = createClient();
  registerReady(client);
  registerInteractionCreate(client);
  await client.login(config.DISCORD_TOKEN);
  return client;
}
