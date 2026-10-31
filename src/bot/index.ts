import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getOrCreateSessionForGuild } from "../watchtogether/store.js";
import { commands } from "./commands.js";

const byName = new Map(commands.map((c) => [c.data.name, c]));

export async function startBot(): Promise<Client> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (c) => {
    try {
      const guild = await c.guilds.fetch(config.DISCORD_GUILD_ID);
      await guild.commands.set(commands.map((cmd) => cmd.data.toJSON()));
      logger.info(`logged in as ${c.user.tag}, ${commands.length} command(s) in ${guild.name}`);
    } catch (err) {
      logger.fatal({ err }, "failed to register slash commands");
      process.exit(1);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
    const command = byName.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, getOrCreateSessionForGuild(interaction.guildId));
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, "command failed");
      const message = { content: "Something went wrong.", flags: MessageFlags.Ephemeral } as const;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(message).catch(() => {});
      } else {
        await interaction.reply(message).catch(() => {});
      }
    }
  });

  await client.login(config.DISCORD_TOKEN);
  return client;
}
