import { SlashCommandBuilder } from "discord.js";
import { logger } from "../../logger.js";
import {
  applyControl,
  getOrCreateSessionForGuild,
  serializeForClient,
} from "../../watchtogether/index.js";
import { ensureNowPlaying } from "../nowPlaying.js";
import { resolveInput } from "../resolver.js";
import { findThisIsPlaylistUrl, isConfigured } from "../spotify.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("thisis")
    .setDescription("Play a 'This Is <artist>' playlist from Spotify")
    .addStringOption((o) =>
      o.setName("artist").setDescription("Artist name").setRequired(true),
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
    if (!isConfigured()) {
      await interaction.reply({
        content: "Spotify integration not configured — see README.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();
    const artist = interaction.options.getString("artist", true);

    let lookup: Awaited<ReturnType<typeof findThisIsPlaylistUrl>>;
    try {
      lookup = await findThisIsPlaylistUrl(artist);
    } catch (err) {
      logger.error({ err, artist }, "findThisIsPlaylistUrl failed");
      await interaction.editReply(
        `Error looking up Spotify: ${(err as Error).message}`,
      );
      return;
    }
    if (!lookup) {
      await interaction.editReply(
        `No "This Is …" playlist found for **${artist}**.`,
      );
      return;
    }

    const result = await resolveInput(lookup.url);
    if (!result.ok) {
      const message =
        result.reason === "not-found"
          ? "Playlist could not be resolved."
          : result.reason === "spotify-not-configured"
            ? "Spotify integration not configured — see README."
            : `Error: ${result.detail ?? "unknown"}`;
      await interaction.editReply(message);
      return;
    }

    const session = getOrCreateSessionForGuild(interaction.guildId);
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

    await interaction.editReply(
      `Queued ${result.tracks.length} tracks from **This Is ${lookup.artistDisplayName}**`,
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
