import { SlashCommandBuilder } from "discord.js";
import { getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { error, nowPlaying } from "../embeds.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("np")
    .setDescription("Show what's playing right now")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (!session.current) {
      await interaction.reply({ embeds: [error("Nothing playing.")], ephemeral: true });
      return;
    }
    const paused = session.current.pausedAtPositionSec != null;
    await interaction.reply({ embeds: [nowPlaying(session.current, paused)] });
  },
};

export default command;
