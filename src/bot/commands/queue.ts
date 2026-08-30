import { SlashCommandBuilder } from "discord.js";
import { getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { queueList } from "../embeds.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current queue")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    await interaction.reply({ embeds: [queueList(session.queue, session.current)] });
  },
};

export default command;
