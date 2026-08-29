import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { getVideoMetadata } from "../resolver.js";
import type { Command } from "./_types.js";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
      await interaction.reply({ content: "Nothing playing.", ephemeral: true });
      return;
    }
    const meta = getVideoMetadata(session.current.videoId);
    const embed = new EmbedBuilder().setColor(0xe8935c);
    if (meta) {
      embed
        .setTitle(meta.title)
        .setDescription(`${meta.author} · ${formatDuration(session.current.durationSec)}`);
    } else {
      embed
        .setTitle(session.current.videoId)
        .setDescription(formatDuration(session.current.durationSec));
    }
    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
