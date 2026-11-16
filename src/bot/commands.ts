import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config.js";
import { signJoinToken } from "../joinToken.js";
import { applyControl, type ControlOptions, setAutoplay } from "../watchtogether/control.js";
import { isStatsOptedOut, setStatsOptOut } from "../watchtogether/plays.js";
import type { LastAction, Person, Session } from "../watchtogether/session.js";
import { derivePosition } from "../watchtogether/timeline.js";
import { adoptPlayer, postPlayer } from "./player.js";
import { type ResolveResult, resolveArtist, resolveInput } from "./resolver.js";
import { parseSeek } from "./time.js";
import {
  describe,
  formatDuration,
  historyView,
  joinView,
  logLine,
  playerView,
  queueView,
} from "./views.js";

type Interaction = ChatInputCommandInteraction<"cached">;

export interface Command {
  data: Pick<SlashCommandBuilder, "name" | "toJSON">;
  execute(interaction: Interaction, session: Session): Promise<unknown>;
}

const noPings = { parse: [] };

export function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

export function joinReply(session: Session, { userId, name }: Person) {
  const token = signJoinToken({ sid: session.id, gid: session.guildId, dn: name, uid: userId });
  const url = `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/#${session.id}&t=${token}`;
  return { ...joinView(url, name), flags: MessageFlags.Ephemeral } as const;
}

export function queueReply(session: Session) {
  return { ...queueView(session, 0), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as const;
}

// Session changes shared by slash commands and buttons. Each returns an error
// message, or what it did. Slash commands pass `silent`, since their own reply
// is the log line.

/** An error message, or the action that was applied. */
export type Outcome = string | LastAction;

export function pause(session: Session, opts: ControlOptions): Outcome {
  if (!session.current) return "Nothing to pause.";
  if (session.current.pausedAtPositionSec != null) return "Already paused.";
  return applyControl(session, { kind: "pause" }, opts)!;
}

export function resume(session: Session, opts: ControlOptions): Outcome {
  if (session.current?.pausedAtPositionSec == null) return "Nothing to resume.";
  return applyControl(session, { kind: "play" }, opts)!;
}

export function seek(session: Session, input: string, opts: ControlOptions): Outcome {
  if (!session.current) return "Nothing playing to seek in.";
  const toSec = parseSeek(input, derivePosition(session));
  if (toSec === null) return "Use a time like `1:23`, `83`, `+30` or `-10`.";
  if (toSec > session.current.durationSec) return `That's past the end (${formatDuration(session.current.durationSec)}).`;
  return applyControl(session, { kind: "seek", toSec }, opts)!;
}

export function skip(session: Session, opts: ControlOptions): Outcome {
  if (!session.current && session.queue.length === 0) return "Nothing to skip.";
  return applyControl(session, { kind: "skip" }, opts)!;
}

/** Whether the bot may post plain messages in the interaction's channel. */
function canPost(interaction: Interaction): boolean {
  const channel = interaction.channel;
  if (!channel?.isSendable()) return false;
  const send = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  return interaction.appPermissions.has([PermissionFlagsBits.ViewChannel, send]);
}

/**
 * Re-posts the player at the bottom of the channel once `reply` has landed.
 * When the bot can't post there, the player becomes a follow-up to the
 * command instead. Call it in the same tick as the change.
 */
async function playerBelow(interaction: Interaction, session: Session, reply: Promise<unknown>): Promise<unknown> {
  const channel = interaction.channel;
  const posted = channel?.isSendable() && canPost(interaction) ? postPlayer(channel, session, reply) : undefined;
  await reply;
  if (posted && (await posted)) return undefined;
  adoptPlayer(await interaction.followUp(playerView(session)), session);
  return undefined;
}

/** A command's reply is its log line; Discord's "X used /cmd" header says who. */
function lineReply(action: LastAction) {
  return { content: logLine(describe(action)), allowedMentions: noPings };
}

/** Whoever clicked or ran a command, as a Person. */
export function person(interaction: { member: { displayName: string }; user: { id: string } }): Person {
  return { userId: interaction.user.id, name: interaction.member.displayName };
}

/** Control options naming whoever did it: their name for the log, their id for the play log. */
export function who(interaction: { member: { displayName: string }; user: { id: string } }): ControlOptions {
  return { by: interaction.member.displayName, userId: interaction.user.id };
}

/** Runs a change; replies with its error privately, or with its log line followed by the player. */
function act(interaction: Interaction, session: Session, change: (opts: ControlOptions) => Outcome) {
  const outcome = change({ ...who(interaction), silent: true });
  if (typeof outcome === "string") return interaction.reply(ephemeral(outcome));
  return playerBelow(interaction, session, interaction.reply(lineReply(outcome)));
}

/** /np: just the player, moved to the bottom of the channel. */
async function showPlayer(interaction: Interaction, session: Session): Promise<unknown> {
  const channel = interaction.channel;
  if (channel?.isSendable() && canPost(interaction)) {
    const posted = postPlayer(channel, session);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (await posted) return interaction.deleteReply().catch(() => {});
    return interaction.editReply("Couldn't post the player in this channel.");
  }
  await interaction.deferReply();
  adoptPlayer(await interaction.editReply(playerView(session)), session);
  return undefined;
}

function slash(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder().setName(name).setDescription(description);
}

const THISIS_DEFAULT_COUNT = 50;
const THISIS_MAX_COUNT = 100;

/**
 * Queues a deferred lookup's tracks. The reply becomes the public log line
 * followed by the player; failures go private.
 */
async function enqueue(
  interaction: Interaction,
  session: Session,
  result: ResolveResult,
  next = false,
): Promise<unknown> {
  if (!result.ok) {
    await interaction.deleteReply().catch(() => {});
    return interaction.followUp(ephemeral(result.message));
  }
  const queued = applyControl(
    session,
    { kind: "enqueue", tracks: result.tracks, next },
    { ...who(interaction), silent: true, ...(result.playlistName ? { label: result.playlistName } : {}) },
  )!;
  // Say what didn't make it: "queued 12 of 14 tracks from X · 2 not found on YouTube".
  const action = result.dropped ? { ...queued, of: result.total, dropped: result.dropped } : queued;
  return playerBelow(interaction, session, interaction.editReply(lineReply(action)));
}

export const commands: Command[] = [
  {
    data: slash("join", "Get your personal link to this server's watch session"),
    execute: (interaction, session) => interaction.reply(joinReply(session, person(interaction))),
  },
  {
    data: slash("play", "Queue a YouTube or Spotify link, or search YouTube").addStringOption((o) =>
      o.setName("query").setDescription("Link or search text").setRequired(true),
    ),
    async execute(interaction, session) {
      await interaction.deferReply(); // lookups can be slow
      return enqueue(interaction, session, await resolveInput(interaction.options.getString("query", true)));
    },
  },
  {
    data: slash("playnext", "Queue a YouTube or Spotify link, or search YouTube, to play next").addStringOption((o) =>
      o.setName("query").setDescription("Link or search text").setRequired(true),
    ),
    async execute(interaction, session) {
      await interaction.deferReply();
      return enqueue(interaction, session, await resolveInput(interaction.options.getString("query", true)), true);
    },
  },
  {
    data: slash("thisis", "Queue an artist's newest and most popular songs")
      .addStringOption((o) => o.setName("artist").setDescription("Artist name").setRequired(true))
      .addIntegerOption((o) =>
        o
          .setName("count")
          .setDescription(`How many songs (default ${THISIS_DEFAULT_COUNT})`)
          .setMinValue(1)
          .setMaxValue(THISIS_MAX_COUNT),
      ),
    async execute(interaction, session) {
      await interaction.deferReply();
      const artist = interaction.options.getString("artist", true);
      const count = interaction.options.getInteger("count") ?? THISIS_DEFAULT_COUNT;
      return enqueue(interaction, session, await resolveArtist(artist, count));
    },
  },
  {
    data: slash("pause", "Pause playback"),
    execute: (interaction, session) => act(interaction, session, (opts) => pause(session, opts)),
  },
  {
    data: slash("resume", "Resume playback"),
    execute: (interaction, session) => act(interaction, session, (opts) => resume(session, opts)),
  },
  {
    data: slash("skip", "Skip the current video"),
    execute: (interaction, session) => act(interaction, session, (opts) => skip(session, opts)),
  },
  {
    data: slash("seek", "Jump to a time in the current video").addStringOption((o) =>
      o.setName("time").setDescription("e.g. 1:23, 83, +30 or -10").setRequired(true),
    ),
    execute: (interaction, session) =>
      act(interaction, session, (opts) => seek(session, interaction.options.getString("time", true), opts)),
  },
  {
    data: slash("np", "Move the player to the bottom of this channel"),
    execute: (interaction, session) => showPlayer(interaction, session),
  },
  {
    data: slash("queue", "Show and edit the queue (only you see it)"),
    execute: (interaction, session) => interaction.reply(queueReply(session)),
  },
  {
    data: slash("history", "Show recently played videos (only you see it)"),
    execute: (interaction, session) =>
      interaction.reply({ ...historyView(session, 0), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }),
  },
  {
    data: slash("replay", "Add the current video back to the queue"),
    execute: (interaction, session) =>
      act(interaction, session, (opts) => {
        if (!session.current) return "Nothing playing to replay.";
        const { startedAtServerMs: _s, pausedAtPositionSec: _p, ...track } = session.current;
        return applyControl(session, { kind: "enqueue", tracks: [track] }, { ...opts, repeat: true })!;
      }),
  },
  {
    data: slash("remove", "Remove a video from the queue").addIntegerOption((o) =>
      o.setName("position").setDescription("Position in the queue").setMinValue(1).setRequired(true),
    ),
    execute: (interaction, session) =>
      act(interaction, session, (opts) => {
        const position = interaction.options.getInteger("position", true);
        if (!session.queue[position - 1]) return `No video at position ${position}.`;
        return applyControl(session, { kind: "remove", index: position - 1 }, opts)!;
      }),
  },
  {
    data: slash("move", "Move a queued video to a different position")
      .addIntegerOption((o) =>
        o.setName("from").setDescription("Current position").setMinValue(1).setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName("to").setDescription("New position").setMinValue(1).setRequired(true),
      ),
    execute: (interaction, session) =>
      act(interaction, session, (opts) => {
        const from = interaction.options.getInteger("from", true);
        const to = interaction.options.getInteger("to", true);
        const size = session.queue.length;
        if (from > size || to > size) {
          return `The queue has ${size} video${size === 1 ? "" : "s"}; position out of range.`;
        }
        if (from === to) return "Source and target are the same position.";
        return applyControl(session, { kind: "reorder", from: from - 1, to: to - 1 }, opts)!;
      }),
  },
  {
    data: slash("clear", "Empty the queue (keeps the current video playing)"),
    execute: (interaction, session) =>
      act(interaction, session, (opts) => {
        if (session.queue.length === 0) return "Queue is already empty.";
        return applyControl(session, { kind: "clear" }, opts)!;
      }),
  },
  {
    data: slash("shuffle", "Shuffle the queue (keeps the current video playing)"),
    execute: (interaction, session) =>
      act(interaction, session, (opts) => {
        if (session.queue.length < 2) return "Not enough videos in the queue to shuffle.";
        return applyControl(session, { kind: "shuffle" }, opts)!;
      }),
  },
  {
    data: slash("autoplay", "Choose whether the next queued video starts automatically").addBooleanOption(
      (o) => o.setName("enabled").setDescription("On or off").setRequired(true),
    ),
    execute: (interaction, session) =>
      act(interaction, session, (opts) => {
        const enabled = interaction.options.getBoolean("enabled", true);
        if (session.autoplay === enabled) return `Autoplay is already ${enabled ? "on" : "off"}.`;
        return setAutoplay(session, enabled, opts)!;
      }),
  },
  {
    data: slash("privacy", "Choose whether your listening and picks count in this server's stats").addBooleanOption(
      (o) => o.setName("count_me").setDescription("Count me in stats").setRequired(true),
    ),
    execute: (interaction) => {
      const countMe = interaction.options.getBoolean("count_me", true);
      const { guildId } = interaction;
      const userId = interaction.user.id;
      if (countMe === !isStatsOptedOut(guildId, userId)) {
        return interaction.reply(ephemeral(countMe ? "You're already counted in stats." : "You're already left out of stats."));
      }
      setStatsOptOut(guildId, userId, !countMe);
      return interaction.reply(
        ephemeral(
          countMe
            ? "What you play and listen to here counts in this server's stats again, from now on."
            : "What you play and listen to here no longer counts in this server's stats, and what was recorded about you here is deleted. Run `/privacy count_me:True` to be counted again.",
        ),
      );
    },
  },
];
