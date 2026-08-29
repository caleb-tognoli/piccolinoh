import type { Client } from "discord.js";
import { config } from "../config.js";
import { createClient } from "./client.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { registerReady } from "./events/ready.js";

export async function startBot(): Promise<Client> {
  const client = createClient();
  registerReady(client);
  registerInteractionCreate(client);
  await client.login(config.DISCORD_TOKEN);
  return client;
}
