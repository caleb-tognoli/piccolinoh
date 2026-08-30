import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { error, ok } from "../embeds.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Empty the queue (does not stop the current track)")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (session.queue.length === 0) {
      await interaction.reply({ embeds: [error("Queue is already empty.")], ephemeral: true });
      return;
    }
    const count = session.queue.length;
    applyControl(session, { kind: "clear" }, interaction.user.id);
    await interaction.reply({
      embeds: [ok("Queue cleared", `${count} track${count === 1 ? "" : "s"} removed.`)],
    });
  },
};

export default command;
