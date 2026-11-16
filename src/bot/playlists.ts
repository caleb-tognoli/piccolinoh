// /playlist: the guild's saved playlists. Curating them (add, save, rename,
// editing in the private view) answers privately; queueing one posts the
// usual log line, and deleting one posts who did it.
import {
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from "discord.js";
import { applyControl } from "../watchtogether/control.js";
import {
  type AddResult,
  addTracks,
  deletePlaylist,
  findPlaylist,
  getPlaylist,
  listPlaylists,
  MAX_NAME_LENGTH,
  MAX_TRACKS,
  moveTrack,
  type Playlist,
  queuePlaylist,
  queueable,
  removeTrack,
  renamePlaylist,
  restoreTrack,
} from "../watchtogether/playlists.js";
import { emitAction, type LastAction, type Session, type Track } from "../watchtogether/session.js";
import { type Command, ephemeral, lineReply, playerBelow, who } from "./commands.js";
import { livePlayer } from "./player.js";
import { resolveInput } from "./resolver.js";
import {
  capitalize,
  deletePlaylistView,
  describe,
  esc,
  logLine,
  noticeView,
  plural,
  playlistsView,
  playlistView,
} from "./views.js";

type Interaction = ChatInputCommandInteraction<"cached">;
type Click = ButtonInteraction<"cached">;

const v2Ephemeral = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const AUTOCOMPLETE_LIMIT = 25;

/** The private reply after adding to a playlist: "Added 12 tracks to **chill** · 3 already in it". */
export function addedMessage(result: AddResult, dropped?: string): string {
  const { playlist, created, added, duplicates, overflow } = result;
  const name = `**${esc(playlist.name)}**`;
  const head = created
    ? `Made ${name} with ${plural(added, "track")}`
    : added === 0
      ? `Nothing new for ${name}`
      : `Added ${plural(added, "track")} to ${name} (${playlist.tracks.length} now)`;
  const notes = [
    duplicates > 0 ? `${duplicates} already in it` : undefined,
    overflow > 0 ? `${overflow} didn't fit (limit ${MAX_TRACKS})` : undefined,
    dropped,
  ].filter(Boolean);
  return notes.length > 0 ? `${head} · ${notes.join(" · ")}` : head;
}

/** What's playing and/or queued, as plain tracks to keep. */
export function roomTracks(session: Session, what: string): Track[] {
  const tracks: Track[] = [];
  if (what !== "queue" && session.current) {
    const { startedAtServerMs: _s, pausedAtPositionSec: _p, ...track } = session.current;
    tracks.push(track);
  }
  if (what !== "current") tracks.push(...session.queue);
  return tracks;
}

function notFound(name: string): string {
  return `No playlist called **${esc(name)}** · \`/playlist list\` shows them.`;
}

const nameOption = (description: string) => (o: SlashCommandStringOption) =>
  o.setName("name").setDescription(description).setMaxLength(MAX_NAME_LENGTH).setRequired(true).setAutocomplete(true);

export const playlistCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("This server's playlists")
    .addSubcommand((s) =>
      s
        .setName("play")
        .setDescription("Queue a playlist")
        .addStringOption(nameOption("Playlist"))
        .addBooleanOption((o) => o.setName("next").setDescription("Put it at the front of the queue"))
        .addBooleanOption((o) => o.setName("shuffle").setDescription("Queue it in random order")),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a YouTube or Spotify link, or a search, to a playlist (made if new)")
        .addStringOption(nameOption("Playlist"))
        .addStringOption((o) => o.setName("query").setDescription("Link or search text").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("save")
        .setDescription("Add what's playing and queued to a playlist (made if new)")
        .addStringOption(nameOption("Playlist"))
        .addStringOption((o) =>
          o
            .setName("what")
            .setDescription("What to save (default: both)")
            .addChoices(
              { name: "What's playing and the queue", value: "both" },
              { name: "What's playing", value: "current" },
              { name: "The queue", value: "queue" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s.setName("show").setDescription("Show and edit a playlist (only you see it)").addStringOption(nameOption("Playlist")),
    )
    .addSubcommand((s) => s.setName("list").setDescription("This server's playlists (only you see it)"))
    .addSubcommand((s) =>
      s
        .setName("rename")
        .setDescription("Rename a playlist")
        .addStringOption(nameOption("Playlist"))
        .addStringOption((o) =>
          o.setName("new_name").setDescription("New name").setMaxLength(MAX_NAME_LENGTH).setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName("delete").setDescription("Delete a playlist").addStringOption(nameOption("Playlist"))),

  async execute(interaction: Interaction, session: Session) {
    const sub = interaction.options.getSubcommand();
    const { guildId } = interaction;
    if (sub === "list") return interaction.reply({ ...playlistsView(listPlaylists(guildId), 0), flags: v2Ephemeral });

    const name = interaction.options.getString("name", true);
    if (sub === "add") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // lookups can be slow
      const result = await resolveInput(interaction.options.getString("query", true));
      if (!result.ok) return interaction.editReply(result.message);
      const added = addTracks(guildId, name, result.tracks, interaction.user.id);
      return interaction.editReply(typeof added === "string" ? added : addedMessage(added, result.dropped));
    }
    if (sub === "save") {
      const tracks = roomTracks(session, interaction.options.getString("what") ?? "both");
      if (tracks.length === 0) return interaction.reply(ephemeral("Nothing to save."));
      const added = addTracks(guildId, name, tracks, interaction.user.id);
      return interaction.reply(ephemeral(typeof added === "string" ? added : addedMessage(added)));
    }

    const playlist = findPlaylist(guildId, name);
    if (!playlist) return interaction.reply(ephemeral(notFound(name)));
    switch (sub) {
      case "play": {
        const outcome = queuePlaylist(session, playlist, {
          ...who(interaction),
          silent: true,
          next: interaction.options.getBoolean("next") ?? false,
          shuffle: interaction.options.getBoolean("shuffle") ?? false,
        });
        if (typeof outcome === "string") return interaction.reply(ephemeral(outcome));
        return playerBelow(interaction, session, interaction.reply(lineReply(outcome)));
      }
      case "show":
        return interaction.reply({ ...playlistView(playlist, 0), flags: v2Ephemeral });
      case "rename": {
        const newName = interaction.options.getString("new_name", true);
        const error = renamePlaylist(playlist.id, newName);
        const renamed = getPlaylist(playlist.id);
        return interaction.reply(
          ephemeral(error ?? `Renamed **${esc(playlist.name)}** to **${esc(renamed?.name ?? newName)}**.`),
        );
      }
      case "delete":
        return interaction.reply({ ...deletePlaylistView(playlist, 0), flags: v2Ephemeral });
      default:
        return undefined;
    }
  },

  async autocomplete(interaction: AutocompleteInteraction<"cached">) {
    const typed = interaction.options.getFocused().trim().toLowerCase();
    const choices = listPlaylists(interaction.guildId)
      .filter((p) => p.name.toLowerCase().includes(typed))
      // Names starting with what's typed first.
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(typed)) - Number(!b.name.toLowerCase().startsWith(typed)))
      .slice(0, AUTOCOMPLETE_LIMIT)
      .map((p) => ({ name: `${p.name} · ${plural(p.trackCount, "track")}`, value: p.name }));
    return interaction.respond(choices);
  },
};

/** "/playlist list" page buttons: `playlists:page:<page>:…`. */
export function onPlaylistsClick(click: Click, op: string, args: string[]): Promise<unknown> {
  if (op !== "page") return Promise.resolve();
  return click.update(playlistsView(listPlaylists(click.guildId), Number(args[0])));
}

/** Buttons on a playlist's private view: `playlist:<id>:<op>:<page>[:<index>]:<videoId>`. */
export async function onPlaylistClick(click: Click, session: Session, args: string[]): Promise<unknown> {
  const [idText = "", op = "", pageText = "0", ...rest] = args;
  const page = Number(pageText);
  const playlist = getPlaylist(Number(idText));
  if (!playlist || playlist.guildId !== click.guildId) return click.update(noticeView("That playlist was deleted."));
  const show = (notice?: string, undo?: string) => click.update(playlistView(getPlaylist(playlist.id)!, page, notice, undo));

  switch (op) {
    case "page":
      return show();
    case "all":
    case "next": {
      const outcome = queuePlaylist(session, playlist, { ...who(click), next: op === "next" });
      return show(capitalize(typeof outcome === "string" ? outcome : describe(outcome)));
    }
    case "del":
      return click.update(deletePlaylistView(playlist, page));
    case "delok": {
      deletePlaylist(playlist.id);
      const action: LastAction = { kind: "playlistDelete", name: playlist.name, count: playlist.tracks.length, by: who(click).by! };
      const hasPlayer = livePlayer(click.guildId) !== undefined;
      // The action log posts it above the player; with no player, post it here.
      emitAction(session, action);
      await click.update(noticeView(`Deleted **${esc(playlist.name)}**.`));
      if (!hasPlayer) await click.followUp({ content: logLine(describe(action), action.by), allowedMentions: { parse: [] } });
      return undefined;
    }
    case "undo": {
      const track = restoreTrack(playlist.id, rest[0] ?? "");
      return show(track ? `Put back **${esc(track.title)}**` : "Too late to put it back");
    }
  }

  // Per-track buttons name the track they were drawn for; refuse if the playlist moved underneath.
  const index = Number(rest[0]);
  const videoId = rest[1] ?? "";
  const track = playlist.tracks[index];
  if (track?.videoId !== videoId) return show("Playlist changed — refreshed");
  switch (op) {
    case "q": {
      const [queued] = queueable(playlist).slice(index, index + 1);
      const done = applyControl(
        session,
        { kind: "enqueue", tracks: [queued!] },
        { ...who(click), playlist: { id: playlist.id, name: playlist.name } },
      );
      return show(done && capitalize(describe(done)));
    }
    case "up":
    case "down": {
      const to = op === "up" ? index - 1 : index + 1;
      return show(moveTrack(playlist.id, index, to, videoId) ? `Moved **${esc(track.title)}** to #${to + 1}` : undefined);
    }
    case "rm":
      return removeTrack(playlist.id, index, videoId)
        ? show(`Removed **${esc(track.title)}**`, videoId)
        : show("Playlist changed — refreshed");
    default:
      return undefined;
  }
}
