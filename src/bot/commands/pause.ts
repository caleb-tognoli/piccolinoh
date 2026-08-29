import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause playback")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (!session.current) {
      await interaction.reply({ content: "Nothing to pause.", ephemeral: true });
      return;
    }
    if (session.current.pausedAtPositionSec != null) {
      await interaction.reply({ content: "Already paused.", ephemeral: true });
      return;
    }
    applyControl(session, { kind: "pause" }, interaction.user.id);
    await interaction.reply("Paused.");
  },
};

export default command;
