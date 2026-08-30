import { SlashCommandBuilder } from "discord.js";
import { updateSessionSettingsForGuild } from "../../watchtogether/index.js";
import { error, ok } from "../embeds.js";
import { setGuildAutoplay, setGuildSkipmode } from "../resolver.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Adjust per-guild settings")
    .setDMPermission(false)
    .addSubcommand((sc) =>
      sc
        .setName("skipmode")
        .setDescription("Who can skip tracks (enforcement lands later)")
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
    )
    .addSubcommand((sc) =>
      sc
        .setName("autoplay")
        .setDescription("Automatically play the next queued track when one ends")
        .addStringOption((o) =>
          o
            .setName("state")
            .setDescription("on | off")
            .setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
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
        embeds: [
          ok("Skip mode set", `\`${mode}\` — enforcement lands in a later phase.`),
        ],
        ephemeral: true,
      });
      return;
    }
    if (sub === "autoplay") {
      const state = interaction.options.getString("state", true) as "on" | "off";
      const on = state === "on";
      setGuildAutoplay(interaction.guildId, on);
      updateSessionSettingsForGuild(interaction.guildId, { autoplay: on });
      await interaction.reply({
        embeds: [ok("Autoplay", on ? "On" : "Off")],
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({ embeds: [error("Unknown subcommand.")], ephemeral: true });
  },
};

export default command;
