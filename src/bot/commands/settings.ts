import { SlashCommandBuilder } from "discord.js";
import { setGuildSkipmode } from "../youtube.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Adjust per-guild settings")
    .setDMPermission(false)
    .addSubcommand((sc) =>
      sc
        .setName("skipmode")
        .setDescription("Who can skip tracks (enforcement lands in a later phase)")
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("anyone | vote | dj")
            .setRequired(true)
            .addChoices(
              { name: "anyone", value: "anyone" },
              { name: "vote", value: "vote" },
              { name: "dj", value: "dj" },
            ),
        ),
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand(true);
    if (sub === "skipmode") {
      const mode = interaction.options.getString("mode", true) as "anyone" | "vote" | "dj";
      setGuildSkipmode(interaction.guildId, mode);
      await interaction.reply({
        content: `Skip mode set to \`${mode}\` (enforcement lands in Phase 4).`,
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  },
};

export default command;
