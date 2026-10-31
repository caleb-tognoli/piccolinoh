import {
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config.js";
import { signJoinToken } from "../joinToken.js";
import { logger } from "../logger.js";
import { applyControl } from "../watchtogether/control.js";
import type { Session } from "../watchtogether/session.js";
import { showBoard } from "./board.js";
import * as embeds from "./embeds.js";
import { resolveInput } from "./resolver.js";

type Interaction = ChatInputCommandInteraction<"cached">;

export interface Command {
  data: Pick<SlashCommandBuilder, "name" | "toJSON">;
  execute(interaction: Interaction, session: Session): Promise<unknown>;
}

function reply(interaction: Interaction, embed: EmbedBuilder, ephemeral = false) {
  return interaction.reply({ embeds: [embed], ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
}

function replyError(interaction: Interaction, message: string) {
  return reply(interaction, embeds.error(message), true);
}

function slash(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder().setName(name).setDescription(description);
}

export const commands: Command[] = [
  {
    data: slash("join", "Get your personal link to this server's watch session"),
    async execute(interaction, session) {
      const name = interaction.member.displayName;
      const token = signJoinToken({ sid: session.id, gid: session.guildId, dn: name });
      const url = `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/#${session.id}&t=${token}`;
      return reply(
        interaction,
        embeds.info(
          "Join the session",
          `[Open in browser](${url})\n\nThis link is yours — anyone who opens it appears in the room as **${name}**.`,
        ),
        true,
      );
    },
  },
  {
    data: slash("play", "Queue a YouTube or Spotify link, or search YouTube").addStringOption((o) =>
      o.setName("query").setDescription("Link or search text").setRequired(true),
    ),
    async execute(interaction, session) {
      await interaction.deferReply();
      const result = await resolveInput(interaction.options.getString("query", true));
      if (!result.ok) return interaction.editReply({ embeds: [embeds.error(result.message)] });

      const startedNow = !session.current;
      applyControl(session, { kind: "enqueue", tracks: result.tracks });
      const embed = result.playlistName
        ? embeds.queuedMany(result.tracks.length, result.playlistName)
        : embeds.queued(result.tracks[0]!, startedNow);
      await interaction.editReply({ embeds: [embed] });

      if (interaction.channel) {
        await showBoard(interaction.channel, session).catch((err: unknown) =>
          logger.warn({ err }, "failed to post queue board"),
        );
      }
    },
  },
  {
    data: slash("pause", "Pause playback"),
    async execute(interaction, session) {
      if (!session.current) return replyError(interaction, "Nothing to pause.");
      if (session.current.pausedAtPositionSec != null) return replyError(interaction, "Already paused.");
      applyControl(session, { kind: "pause" });
      return reply(interaction, embeds.ok("Paused"));
    },
  },
  {
    data: slash("resume", "Resume playback"),
    async execute(interaction, session) {
      if (session.current?.pausedAtPositionSec == null) return replyError(interaction, "Nothing to resume.");
      applyControl(session, { kind: "play" });
      return reply(interaction, embeds.ok("Resumed"));
    },
  },
  {
    data: slash("skip", "Skip the current video"),
    async execute(interaction, session) {
      if (!session.current) return replyError(interaction, "Nothing to skip.");
      applyControl(session, { kind: "skip" });
      return reply(interaction, embeds.ok("Skipped"));
    },
  },
  {
    data: slash("np", "Show what's playing right now"),
    async execute(interaction, session) {
      if (!session.current) return replyError(interaction, "Nothing playing.");
      return reply(interaction, embeds.nowPlaying(session.current));
    },
  },
  {
    data: slash("queue", "Show the queue"),
    async execute(interaction, session) {
      return reply(interaction, embeds.queueList(session));
    },
  },
  {
    data: slash("history", "Show recently played videos"),
    async execute(interaction, session) {
      return reply(interaction, embeds.historyList(session.history));
    },
  },
  {
    data: slash("replay", "Add the current video back to the queue"),
    async execute(interaction, session) {
      if (!session.current) return replyError(interaction, "Nothing playing to replay.");
      const { startedAtServerMs: _s, pausedAtPositionSec: _p, ...track } = session.current;
      applyControl(session, { kind: "enqueue", tracks: [track] });
      return reply(interaction, embeds.ok("Replay queued", track.title));
    },
  },
  {
    data: slash("remove", "Remove a video from the queue").addIntegerOption((o) =>
      o.setName("position").setDescription("Position in the queue").setMinValue(1).setRequired(true),
    ),
    async execute(interaction, session) {
      const position = interaction.options.getInteger("position", true);
      const track = session.queue[position - 1];
      if (!track) return replyError(interaction, `No video at position ${position}.`);
      applyControl(session, { kind: "remove", index: position - 1 });
      return reply(interaction, embeds.ok("Removed", track.title));
    },
  },
  {
    data: slash("move", "Move a queued video to a different position")
      .addIntegerOption((o) =>
        o.setName("from").setDescription("Current position").setMinValue(1).setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName("to").setDescription("New position").setMinValue(1).setRequired(true),
      ),
    async execute(interaction, session) {
      const from = interaction.options.getInteger("from", true);
      const to = interaction.options.getInteger("to", true);
      const size = session.queue.length;
      if (from > size || to > size) {
        return replyError(interaction, `The queue has ${size} video(s); position out of range.`);
      }
      if (from === to) return replyError(interaction, "Source and target are the same position.");
      applyControl(session, { kind: "reorder", from: from - 1, to: to - 1 });
      return reply(interaction, embeds.ok("Moved", `Position ${from} → ${to}`));
    },
  },
  {
    data: slash("clear", "Empty the queue (keeps the current video playing)"),
    async execute(interaction, session) {
      const count = session.queue.length;
      if (count === 0) return replyError(interaction, "Queue is already empty.");
      applyControl(session, { kind: "clear" });
      return reply(interaction, embeds.ok("Queue cleared", `${count} video${count === 1 ? "" : "s"} removed.`));
    },
  },
  {
    data: slash("autoplay", "Choose whether the next queued video starts automatically").addBooleanOption(
      (o) => o.setName("enabled").setDescription("On or off").setRequired(true),
    ),
    async execute(interaction, session) {
      session.autoplay = interaction.options.getBoolean("enabled", true);
      return reply(interaction, embeds.ok("Autoplay", session.autoplay ? "On" : "Off"));
    },
  },
];
