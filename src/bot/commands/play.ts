import { SlashCommandBuilder } from "discord.js";
import { logger } from "../../logger.js";
import {
  applyControl,
  getOrCreateSessionForGuild,
  serializeForClient,
} from "../../watchtogether/index.js";
import { ensureNowPlaying } from "../nowPlaying.js";
import { resolveInput } from "../youtube.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Queue a YouTube URL or search query")
    .addStringOption((o) =>
      o.setName("query").setDescription("URL or text to search").setRequired(true),
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: "This command only works in a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const input = interaction.options.getString("query", true);
    const result = await resolveInput(input);
    if (!result.ok) {
      const message =
        result.reason === "not-found"
          ? "No results."
          : result.reason === "quota-exhausted"
            ? "Search budget used — paste a link."
            : `Error: ${result.detail ?? "unknown"}`;
      await interaction.editReply(message);
      return;
    }

    const session = getOrCreateSessionForGuild(interaction.guildId);
    const wasEmpty = !session.current;
    applyControl(
      session,
      {
        kind: "enqueue",
        videoId: result.track.videoId,
        durationSec: result.track.durationSec,
      },
      interaction.user.id,
    );

    const verb = wasEmpty ? "Playing" : "Queued";
    await interaction.editReply(
      `${verb} **${result.track.title}** — ${result.track.author}`,
    );

    try {
      await ensureNowPlaying(
        interaction.client,
        serializeForClient(session),
        interaction.channelId,
      );
    } catch (err) {
      logger.warn({ err }, "ensureNowPlaying failed");
    }
  },
};

export default command;
