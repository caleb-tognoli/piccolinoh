import type { Client } from "discord.js";
import { config } from "../config.js";
import { setJoinTokenVerifier, setSettingsLoader } from "../watchtogether/index.js";
import { createClient } from "./client.js";
import { openDb } from "./db/index.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { registerReady } from "./events/ready.js";
import { verifyJoinToken } from "./joinToken.js";
import { getGuildSetting } from "./resolver.js";

export async function startBot(): Promise<Client> {
  openDb(config.SQLITE_PATH);

  setSettingsLoader((guildId) => ({ autoplay: getGuildSetting(guildId).autoplay }));

  setJoinTokenVerifier((token, expected) => {
    const payload = verifyJoinToken(token, expected);
    return payload ? { dn: payload.dn } : null;
  });

  const client = createClient();
  registerReady(client);
  registerInteractionCreate(client);
  await client.login(config.DISCORD_TOKEN);
  return client;
}
