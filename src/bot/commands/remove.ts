import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue")
    .addIntegerOption((o) =>
      o
        .setName("position")
        .setDescription("1-based position in the queue")
        .setMinValue(1)
        .setRequired(true),
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const position = interaction.options.getInteger("position", true);
    const index = position - 1;
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (index < 0 || index >= session.queue.length) {
      await interaction.reply({
        content: `No track at position ${position}.`,
        ephemeral: true,
      });
      return;
    }
    const removed = session.queue[index];
    applyControl(session, { kind: "remove", index }, interaction.user.id);
    await interaction.reply(`Removed \`${removed?.videoId ?? position}\` from the queue.`);
  },
};

export default command;
