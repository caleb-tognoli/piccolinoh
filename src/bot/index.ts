import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getOrCreateSessionForGuild } from "../watchtogether/store.js";
import { handleButton } from "./buttons.js";
import { commands } from "./commands.js";
import { startActionLog } from "./log.js";

const byName = new Map(commands.map((c) => [c.data.name, c]));

export async function startBot(): Promise<Client> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  startActionLog();

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
    if (!interaction.inCachedGuild()) return;
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
