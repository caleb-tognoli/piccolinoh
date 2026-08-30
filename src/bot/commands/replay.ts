import { SlashCommandBuilder } from "discord.js";
import { applyControl, getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { error, ok } from "../embeds.js";
import { getVideoMetadata } from "../resolver.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("replay")
    .setDescription("Add the current track back to the queue")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    if (!session.current) {
      await interaction.reply({ embeds: [error("Nothing playing to replay.")], ephemeral: true });
      return;
    }
    const meta = getVideoMetadata(session.current.videoId);
    applyControl(
      session,
      {
        kind: "enqueue",
        videoId: session.current.videoId,
        durationSec: session.current.durationSec,
      },
      interaction.user.id,
    );
    await interaction.reply({
      embeds: [ok("Replay queued", meta?.title ?? session.current.videoId)],
    });
  },
};

export default command;
