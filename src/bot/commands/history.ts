import { SlashCommandBuilder } from "discord.js";
import { getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { historyList } from "../embeds.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show recently played tracks in this session")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    await interaction.reply({ embeds: [historyList(session.history)] });
  },
};

export default command;
