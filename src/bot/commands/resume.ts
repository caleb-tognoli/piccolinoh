import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume playback")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (!session.current || session.current.pausedAtPositionSec == null) {
      await interaction.reply({ content: "Nothing to resume.", ephemeral: true });
      return;
    }
    applyControl(session, { kind: "play" }, interaction.user.id);
    await interaction.reply("Resumed.");
  },
};

export default command;
