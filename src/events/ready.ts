import type { Client } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { loadCommands } from "../commands/loader.js";

export function registerReady(client: Client): void {
  client.once("clientReady", async (c: Client<true>) => {
    try {
      const commands = await loadCommands();
      client.commands = commands;

      const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID);
      const bodies = commands.map((cmd) => cmd.data.toJSON());
      await guild.commands.set(bodies);

      logger.info(
        { user: c.user.tag, commands: commands.size, guild: guild.name },
        `logged in as ${c.user.tag}, ${commands.size} command(s) in ${guild.name}`,
      );
    } catch (err) {
      logger.error({ err }, "failed during ready handler");
      process.exit(1);
    }
  });
}
