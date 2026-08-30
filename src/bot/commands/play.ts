import { SlashCommandBuilder } from "discord.js";
import { logger } from "../../logger.js";
import {
  applyControl,
  getOrCreateSessionForGuild,
  serializeForClient,
} from "../../watchtogether/index.js";
import { error as errorEmbed, queued, queuedPlaylist } from "../embeds.js";
import { ensureNowPlaying } from "../nowPlaying.js";
import { resolveInput } from "../resolver.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Queue a YouTube or Spotify URL, or a text search")
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
          : result.reason === "spotify-not-configured"
            ? "Spotify integration not configured — see README."
            : result.reason === "spotify-playlist-unavailable"
              ? "Spotify playlist URLs aren't supported — Spotify blocks Client-Credentials apps from reading playlist tracks. Paste an album URL or a track URL instead."
              : `Error: ${result.detail ?? "unknown"}`;
      await interaction.editReply({ embeds: [errorEmbed(message)] });
      return;
    }

    const session = getOrCreateSessionForGuild(interaction.guildId);
    const wasEmpty = !session.current;

    for (const track of result.tracks) {
      applyControl(
        session,
        {
          kind: "enqueue",
          videoId: track.videoId,
          durationSec: track.durationSec,
        },
        interaction.user.id,
      );
    }

    const first = result.tracks[0]!;
    const isSingle = result.tracks.length === 1 && !result.sourceLabel;
    const embed = isSingle
      ? queued(first, wasEmpty)
      : queuedPlaylist(result.tracks.length, result.sourceLabel ?? "Playlist");
    await interaction.editReply({ embeds: [embed] });

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
