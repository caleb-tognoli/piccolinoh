import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (!session.current) {
      await interaction.reply({ content: "Nothing to skip.", ephemeral: true });
      return;
    }
    applyControl(session, { kind: "skip" }, interaction.user.id);
    await interaction.reply("Skipped.");
  },
};

export default command;
