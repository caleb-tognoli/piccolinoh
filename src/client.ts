import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Shoukaku } from "shoukaku";
import type { Command } from "./commands/_types.js";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
    shoukaku: Shoukaku;
  }
}

export function createClient(): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  client.commands = new Collection<string, Command>();
  return client;
}
