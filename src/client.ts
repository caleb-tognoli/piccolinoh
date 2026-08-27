import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Command } from "./commands/_types.js";

export type DodanteClient = Client & {
  commands: Collection<string, Command>;
};

export function createClient(): DodanteClient {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  }) as DodanteClient;

  client.commands = new Collection<string, Command>();
  return client;
}
