import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { error, ok } from "../embeds.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a queued track to a different position")
    .addIntegerOption((o) =>
      o.setName("from").setDescription("Current 1-based position").setMinValue(1).setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName("to").setDescription("Target 1-based position").setMinValue(1).setRequired(true),
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const from = interaction.options.getInteger("from", true) - 1;
    const to = interaction.options.getInteger("to", true) - 1;
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (from < 0 || from >= session.queue.length || to < 0 || to >= session.queue.length) {
      await interaction.reply({
        embeds: [error(`Queue has ${session.queue.length} track(s); position out of range.`)],
        ephemeral: true,
      });
      return;
    }
    if (from === to) {
      await interaction.reply({ embeds: [error("Source and target are the same position.")], ephemeral: true });
      return;
    }
    applyControl(session, { kind: "reorder", from, to }, interaction.user.id);
    await interaction.reply({ embeds: [ok("Moved", `Position ${from + 1} → ${to + 1}`)] });
  },
};

export default command;
