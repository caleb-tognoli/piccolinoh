import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { forgetGuild, getOrCreateSessionForGuild } from "../watchtogether/store.js";
import { handleButton } from "./buttons.js";
import { commands as basics } from "./commands.js";
import { startActionLog } from "./log.js";
import { playlistCommand } from "./playlists.js";

const commands = [...basics, playlistCommand];
const byName = new Map(commands.map((c) => [c.data.name, c]));

export async function startBot(): Promise<Client> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  startActionLog();

  client.once(Events.ClientReady, async (c) => {
    const data = commands.map((cmd) => cmd.data.toJSON());
    try {
      if (config.DISCORD_GUILD_ID) {
        // One server only: changes show up instantly, handy for development.
        const guild = await c.guilds.fetch(config.DISCORD_GUILD_ID);
        await guild.commands.set(data);
        logger.info(`logged in as ${c.user.tag}, ${data.length} command(s) in ${guild.name}`);
      } else {
        // Every server the bot is in. Discord can take a while to show new ones.
        await c.application.commands.set(data);
        await clearGuildCommands(c);
        logger.info(`logged in as ${c.user.tag}, ${data.length} global command(s), ${c.guilds.cache.size} server(s)`);
      }
    } catch (err) {
      logger.fatal({ err }, "failed to register slash commands");
      process.exit(1);
    }
  });

  // Kicked or the server was deleted (an outage is GuildUnavailable instead).
  client.on(Events.GuildDelete, (guild) => {
    forgetGuild(guild.id);
    logger.info({ guildId: guild.id }, "left a server: room and playlists deleted");
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.inCachedGuild()) return;
    if (interaction.isAutocomplete()) {
      await byName
        .get(interaction.commandName)
        ?.autocomplete?.(interaction)
        .catch((err: unknown) => logger.warn({ err, interaction: interaction.commandName }, "autocomplete failed"));
      return;
    }
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
    const session = getOrCreateSessionForGuild(interaction.guildId);
    const label = interaction.isButton() ? interaction.customId : interaction.commandName;

    try {
      if (interaction.isButton()) {
        await handleButton(interaction, session);
      } else {
        await byName.get(interaction.commandName)?.execute(interaction, session);
      }
    } catch (err) {
      logger.error({ err, interaction: label }, "interaction failed");
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

/**
 * Removes commands left over from running with DISCORD_GUILD_ID, which would
 * otherwise show up twice next to the global ones in those servers.
 */
async function clearGuildCommands(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const existing = await guild.commands.fetch();
      if (existing.size === 0) continue;
      await guild.commands.set([]);
      logger.info(`removed ${existing.size} server-only command(s) from ${guild.name}`);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "failed to clear server-only commands");
    }
  }
}
