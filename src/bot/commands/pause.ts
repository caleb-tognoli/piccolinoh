import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { error, ok } from "../embeds.js";
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
      await interaction.reply({ embeds: [error("Nothing to pause.")], ephemeral: true });
      return;
    }
    if (session.current.pausedAtPositionSec != null) {
      await interaction.reply({ embeds: [error("Already paused.")], ephemeral: true });
      return;
    }
    applyControl(session, { kind: "pause" }, interaction.user.id);
    await interaction.reply({ embeds: [ok("Paused")] });
  },
};

export default command;
