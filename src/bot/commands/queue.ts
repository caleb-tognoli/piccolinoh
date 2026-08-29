import { SlashCommandBuilder } from "discord.js";
import { getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { getVideoMetadata } from "../resolver.js";
import type { Command } from "./_types.js";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function describe(videoId: string, durationSec: number): string {
  const meta = getVideoMetadata(videoId);
  const title = meta ? meta.title : videoId;
  return `${title} · ${formatDuration(durationSec)}`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current queue")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    const lines: string[] = [];
    if (session.current) {
      lines.push(`▶ ${describe(session.current.videoId, session.current.durationSec)}`);
    } else {
      lines.push("_Nothing playing_");
    }
    if (session.queue.length === 0) {
      lines.push("_Queue empty_");
    } else {
      lines.push("");
      lines.push("**Up next**");
      session.queue.forEach((item, i) => {
        lines.push(`${i + 1}. ${describe(item.videoId, item.durationSec)}`);
      });
    }
    await interaction.reply(lines.join("\n"));
  },
};

export default command;
