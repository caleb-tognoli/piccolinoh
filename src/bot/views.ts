// Pure renderers for everything the bot posts. Messages use Components V2
// (containers, text, buttons), so they carry no `content` or embeds.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  escapeMarkdown,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import type { Playlist, PlaylistSummary, PlaylistTrack } from "../watchtogether/playlists.js";
import type { LastAction, Session, Track } from "../watchtogether/session.js";
import { derivePosition } from "../watchtogether/timeline.js";

const COLORS = {
  playing: 0x53c47a,
  paused: 0xe5a50a,
  idle: 0x80848e,
  list: 0x8a7ee6,
} as const;

export const PAGE_SIZE = 5;

/** Custom-id prefixes routed by the interaction handler. */
export const ID = {
  player: "player",
  queue: "queue",
  history: "history",
  /** One playlist's view: `playlist:<id>:<op>:<page>…`. */
  playlist: "playlist",
  playlists: "playlists",
} as const;

export type PlayerOp = "toggle" | "skip" | "join";
export type QueueOp = "top" | "up" | "down" | "rm";
/** Per-track buttons in a playlist's view. */
export type PlaylistTrackOp = "q" | "up" | "down" | "rm";

export interface V2Message {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
}

export function formatDuration(sec: number): string {
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Escapes markdown, including the brackets of masked links. */
export function esc(text: string): string {
  return escapeMarkdown(text).replace(/[[\]]/g, "\\$&");
}

function thumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function trackLine(track: Track): string {
  const from = track.startSec ? ` · from ${formatDuration(track.startSec)}` : "";
  const added = track.addedBy ? ` · added by ${esc(track.addedBy.name)}` : "";
  return `**${esc(track.title)}** — ${esc(track.author)} · ${formatDuration(track.durationSec)}${from}${added}`;
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function button(customId: string, label: string, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function row(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

function v2(container: ContainerBuilder): V2Message {
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** An action as a phrase starting with its verb ("skipped **A**"), without who did it. */
export function describe(action: LastAction): string {
  switch (action.kind) {
    case "play":
      return "resumed";
    case "pause":
      return "paused";
    case "skip":
      return `skipped **${esc(action.title)}**`;
    case "start":
      return `started **${esc(action.title)}**`;
    case "autoSkip":
      return `skipped **${esc(action.title)}** · can't be embedded`;
    case "finished":
      return "queue finished";
    case "enqueue": {
      const notes = [
        action.dropped,
        action.alsoAt === "now" ? "already playing" : action.alsoAt ? `also at #${action.alsoAt}` : undefined,
        action.alreadyQueued ? `incl. ${action.alreadyQueued} already queued` : undefined,
      ].filter(Boolean);
      const dropped = notes.length > 0 ? ` · ${notes.join(" · ")}` : "";
      if (action.count > 1 || action.of) {
        const from = action.title && action.count > 1 ? ` from **${esc(action.title)}**` : "";
        const what = action.count > 1 ? `${action.count}${action.of ? ` of ${action.of}` : ""} tracks${from}` : `**${esc(action.title)}** (1 of ${action.of})`;
        return `queued ${what}${action.next ? " to play next" : ""}${dropped}`;
      }
      const from = action.fromSec ? ` from ${formatDuration(action.fromSec)}` : "";
      if (action.next) return `queued **${esc(action.title)}**${from} to play next${dropped}`;
      const at = action.position ? ` (#${action.position})` : "";
      return `queued **${esc(action.title)}**${from}${at}${dropped}`;
    }
    case "remove":
      return `removed **${esc(action.title)}**`;
    case "restore":
      return `restored **${esc(action.title)}**`;
    case "reorder":
      return `moved **${esc(action.title)}** to #${action.to}`;
    case "seek":
      return `jumped to ${formatDuration(action.toSec)} in **${esc(action.title)}**`;
    case "clear":
      return `cleared ${action.count} track${action.count === 1 ? "" : "s"}`;
    case "shuffle":
      return `shuffled ${action.count} tracks`;
    case "autoplay":
      return `turned autoplay ${action.enabled ? "on" : "off"}`;
    case "playlistDelete":
      return `deleted playlist **${esc(action.name)}** (${plural(action.count, "track")})`;
  }
}

/** "1 track", "3 tracks". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A log line in Discord subtext: "-# Caleb skipped **A**", or "-# Skipped **A**" with no actor. */
export function logLine(phrase: string, by?: string): string {
  return `-# ${by ? `${esc(by)} ${phrase}` : capitalize(phrase)}`;
}

const BAR_WIDTH = 12;

/** `1:02` ▬▬▬●──────── `3:40` */
export function progressBar(positionSec: number, durationSec: number): string {
  const ratio = durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
  const at = Math.min(BAR_WIDTH - 1, Math.floor(ratio * BAR_WIDTH));
  const bar = "▬".repeat(at) + "●" + "─".repeat(BAR_WIDTH - 1 - at);
  return `\`${formatDuration(positionSec)}\` ${bar} \`${formatDuration(durationSec)}\``;
}

const joinButton = () => button(`${ID.player}:join`, "🔗 Join");

/** The small status label above the title: "-# **NOW PLAYING**". */
function statusLabel(label: string): string {
  return `-# **${label}**`;
}

/**
 * How far in the current track is. Discord renders `<t:…:R>` live ("ends in
 * 2 minutes", then a seconds countdown), so a playing track's line stays
 * current without editing the message; a paused one shows a still bar.
 */
function timeline(session: Session): string {
  const current = session.current!;
  if (current.pausedAtPositionSec != null) return progressBar(current.pausedAtPositionSec, current.durationSec);
  const endsAt = Math.round((current.startedAtServerMs + current.durationSec * 1000) / 1000);
  return `\`${formatDuration(current.durationSec)}\` · ends <t:${endsAt}:R>`;
}

/**
 * The live player: what's playing, how far in, and controls. It renders the
 * same until the session changes (nothing in it depends on the clock), so it
 * can be re-posted on changes instead of edited.
 */
export function playerView(session: Session): V2Message {
  const { current, queue, autoplay } = session;
  const container = new ContainerBuilder();

  if (current) {
    const paused = current.pausedAtPositionSec != null;
    container.setAccentColor(paused ? COLORS.paused : COLORS.playing);
    const lines = [
      statusLabel(paused ? "PAUSED" : "NOW PLAYING"),
      `**[${esc(current.title)}](https://youtu.be/${current.videoId})**`,
      esc(current.author),
    ];
    if (current.addedBy) lines.push(`-# added by ${esc(current.addedBy.name)}`);
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(lines.join("\n")))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail(current.videoId))),
    );
    const details = [timeline(session)];
    if (!autoplay) details.push("-# Autoplay off · stops after this track");
    container.addTextDisplayComponents(text(details.join("\n")));
    container.addActionRowComponents(
      row(
        paused
          ? button(`${ID.player}:toggle`, "▶ Resume", ButtonStyle.Primary)
          : button(`${ID.player}:toggle`, "⏸ Pause"),
        button(`${ID.player}:skip`, "⏭ Skip"),
        joinButton(),
      ),
    );
    return v2(container);
  }

  container.setAccentColor(COLORS.idle);
  if (queue.length > 0) {
    // Autoplay stopped after a track; the queue is waiting.
    const lines = [statusLabel("STOPPED")];
    if (!autoplay) lines.push("-# Autoplay off");
    container.addTextDisplayComponents(text(lines.join("\n")));
    container.addActionRowComponents(
      row(button(`${ID.player}:skip`, "▶ Play next", ButtonStyle.Primary), joinButton()),
    );
    return v2(container);
  }

  container.addTextDisplayComponents(text("Nothing playing · `/play` to queue something"));
  container.addActionRowComponents(row(joinButton()));
  return v2(container);
}

/** What an old player message turns into once a newer one is live. */
export function stalePlayerView(): V2Message {
  return v2(
    new ContainerBuilder()
      .setAccentColor(COLORS.idle)
      .addTextDisplayComponents(text("-# This player is no longer live · `/np` shows the current one")),
  );
}

function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function clampPage(page: number, total: number, size = PAGE_SIZE): number {
  return Math.min(Math.max(0, page), pageCount(total, size) - 1);
}

/** First / previous / position / next / last; undefined when everything fits on one page. */
function pager(prefix: string, page: number, total: number, size = PAGE_SIZE): ActionRowBuilder<ButtonBuilder> | undefined {
  const pages = pageCount(total, size);
  if (pages <= 1) return undefined;
  const last = pages - 1;
  return row(
    button(`${prefix}:page:0:first`, "⏮").setDisabled(page === 0),
    button(`${prefix}:page:${page - 1}:prev`, "◀").setDisabled(page === 0),
    button(`${prefix}:page:${page}:at`, `${page + 1}/${pages}`).setDisabled(true),
    button(`${prefix}:page:${page + 1}:next`, "▶").setDisabled(page >= last),
    button(`${prefix}:page:${last}:last`, "⏭").setDisabled(page >= last),
  );
}

/** The list header, with an icon-only refresh button beside it. */
function listHeader(prefix: string, page: number, lines: string[]): SectionBuilder {
  return new SectionBuilder()
    .addTextDisplayComponents(text(lines.join("\n")))
    .setButtonAccessory(button(`${prefix}:page:${page}:refresh`, "↻"));
}

function totalDuration(tracks: { durationSec: number }[]): string {
  return formatDuration(tracks.reduce((sum, t) => sum + t.durationSec, 0));
}

/**
 * Seconds until each queued track starts, or undefined when that isn't
 * predictable (nothing playing, paused, or autoplay off).
 */
export function queueEtas(session: Session, nowMs = Date.now()): number[] | undefined {
  const { current, queue, autoplay } = session;
  if (!current || current.pausedAtPositionSec != null || !autoplay) return undefined;
  let at = Math.max(0, current.durationSec - derivePosition(session, nowMs));
  return queue.map((track) => {
    const eta = at;
    at += track.durationSec;
    return eta;
  });
}

/** Ephemeral queue page; each track has its own play-next / up / down / remove buttons. */
export function queueView(session: Session, page: number, notice?: string, nowMs = Date.now()): V2Message {
  const { queue, current } = session;
  const etas = queueEtas(session, nowMs);
  page = clampPage(page, queue.length);
  const container = new ContainerBuilder().setAccentColor(COLORS.list);

  const header =
    queue.length > 0
      ? [`**Queue** · ${queue.length} track${queue.length === 1 ? "" : "s"} · ${totalDuration(queue)}`]
      : ["**Queue** is empty · `/play` to add something"];
  if (current) header.push(`-# Now playing: ${esc(current.title)}`);
  if (notice) header.push(`-# ✓ ${notice}`);
  container.addSectionComponents(listHeader(ID.queue, page, header));

  const start = page * PAGE_SIZE;
  queue.slice(start, start + PAGE_SIZE).forEach((track, i) => {
    const index = start + i;
    const id = (op: QueueOp) => `${ID.queue}:${op}:${page}:${index}:${track.videoId}`;
    const first = index === 0;
    const last = index === queue.length - 1;
    const eta = etas ? ` · *in ${formatDuration(etas[index]!)}*` : "";
    container.addTextDisplayComponents(text(`\`${index + 1}.\` ${trackLine(track)}${eta}`));
    container.addActionRowComponents(
      row(
        button(id("top"), "⏫").setDisabled(first),
        button(id("up"), "▲").setDisabled(first),
        button(id("down"), "▼").setDisabled(last),
        button(id("rm"), "✕", ButtonStyle.Danger),
      ),
    );
  });

  const pages = pager(ID.queue, page, queue.length);
  if (pages) container.addActionRowComponents(pages);
  return v2(container);
}

/** Ephemeral history page, newest first; each track can be queued again. */
export function historyView(session: Session, page: number, notice?: string): V2Message {
  const { history } = session;
  page = clampPage(page, history.length);
  const container = new ContainerBuilder().setAccentColor(COLORS.list);

  const header =
    history.length > 0
      ? [`**Recently played** · ${history.length} track${history.length === 1 ? "" : "s"}`]
      : ["Nothing has played yet."];
  if (notice) header.push(`-# ✓ ${notice}`);
  if (history.length > 0) container.addSectionComponents(listHeader(ID.history, page, header));
  else container.addTextDisplayComponents(text(header.join("\n")));

  const start = page * PAGE_SIZE;
  for (let i = start; i < Math.min(start + PAGE_SIZE, history.length); i++) {
    const index = history.length - 1 - i;
    const track = history[index]!;
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(trackLine(track)))
        .setButtonAccessory(button(`${ID.history}:add:${page}:${index}:${track.videoId}`, "➕")),
    );
  }

  const pages = pager(ID.history, page, history.length);
  if (pages) container.addActionRowComponents(pages);
  return v2(container);
}

/** How many playlists a page of /playlist list shows. */
export const PLAYLISTS_PAGE_SIZE = 10;
/** Tracks per playlist page: its extra action row leaves room for 4 under the 40-component limit. */
export const PLAYLIST_PAGE_SIZE = 4;

/** Ephemeral list of the guild's playlists. */
export function playlistsView(playlists: PlaylistSummary[], page: number): V2Message {
  page = clampPage(page, playlists.length, PLAYLISTS_PAGE_SIZE);
  const container = new ContainerBuilder().setAccentColor(COLORS.list);
  if (playlists.length === 0) {
    container.addTextDisplayComponents(
      text("No playlists yet · `/playlist add` or `/playlist save` to make one"),
    );
    return v2(container);
  }
  const start = page * PLAYLISTS_PAGE_SIZE;
  const lines = playlists
    .slice(start, start + PLAYLISTS_PAGE_SIZE)
    .map((p) => `**${esc(p.name)}** · ${plural(p.trackCount, "track")} · ${formatDuration(p.durationSec)}`);
  container.addSectionComponents(
    listHeader(ID.playlists, page, [`**Playlists** · ${playlists.length}`, "-# `/playlist show` to see one"]),
  );
  container.addTextDisplayComponents(text(lines.join("\n")));
  const pages = pager(ID.playlists, page, playlists.length, PLAYLISTS_PAGE_SIZE);
  if (pages) container.addActionRowComponents(pages);
  return v2(container);
}

function playlistTrackLine(track: PlaylistTrack): string {
  const added = track.addedBy ? ` · added by <@${track.addedBy}>` : "";
  return `**${esc(track.title)}** — ${esc(track.author)} · ${formatDuration(track.durationSec)}${added}`;
}

/**
 * Ephemeral playlist page: queue it all, and per track queue / up / down /
 * remove. `undo` offers putting back a track just removed.
 */
export function playlistView(playlist: Playlist, page: number, notice?: string, undo?: string): V2Message {
  const { tracks } = playlist;
  const prefix = `${ID.playlist}:${playlist.id}`;
  page = clampPage(page, tracks.length, PLAYLIST_PAGE_SIZE);
  const container = new ContainerBuilder().setAccentColor(COLORS.list);

  const header = [
    tracks.length > 0
      ? `**${esc(playlist.name)}** · ${plural(tracks.length, "track")} · ${totalDuration(tracks)}`
      : `**${esc(playlist.name)}** is empty · \`/playlist add\` to add tracks`,
  ];
  if (playlist.createdBy) header.push(`-# Made by <@${playlist.createdBy}>`);
  if (notice) header.push(`-# ✓ ${notice}`);
  container.addSectionComponents(listHeader(prefix, page, header));

  const actions = [
    button(`${prefix}:all:${page}`, "▶ Queue all", ButtonStyle.Primary).setDisabled(tracks.length === 0),
    button(`${prefix}:next:${page}`, "⏭ Play next").setDisabled(tracks.length === 0),
    button(`${prefix}:del:${page}`, "🗑 Delete", ButtonStyle.Danger),
  ];
  if (undo) actions.unshift(button(`${prefix}:undo:${page}:${undo}`, "↶ Undo"));
  container.addActionRowComponents(row(...actions));

  const start = page * PLAYLIST_PAGE_SIZE;
  tracks.slice(start, start + PLAYLIST_PAGE_SIZE).forEach((track, i) => {
    const index = start + i;
    const id = (op: PlaylistTrackOp) => `${prefix}:${op}:${page}:${index}:${track.videoId}`;
    container.addTextDisplayComponents(text(`\`${index + 1}.\` ${playlistTrackLine(track)}`));
    container.addActionRowComponents(
      row(
        button(id("q"), "➕"),
        button(id("up"), "▲").setDisabled(index === 0),
        button(id("down"), "▼").setDisabled(index === tracks.length - 1),
        button(id("rm"), "✕", ButtonStyle.Danger),
      ),
    );
  });

  const pages = pager(prefix, page, tracks.length, PLAYLIST_PAGE_SIZE);
  if (pages) container.addActionRowComponents(pages);
  return v2(container);
}

/** Asks before deleting a playlist; cancelling goes back to its view. */
export function deletePlaylistView(playlist: Playlist, page: number): V2Message {
  const prefix = `${ID.playlist}:${playlist.id}`;
  return v2(
    new ContainerBuilder()
      .setAccentColor(COLORS.paused)
      .addTextDisplayComponents(
        text(
          `Delete **${esc(playlist.name)}** (${plural(playlist.tracks.length, "track")})? This can't be undone, and the server sees who did it.`,
        ),
      )
      .addActionRowComponents(
        row(
          button(`${prefix}:delok:${page}`, "Delete", ButtonStyle.Danger),
          button(`${prefix}:page:${page}:cancel`, "Cancel"),
        ),
      ),
  );
}

/** A private view's final state: just a line. */
export function noticeView(content: string): V2Message {
  return v2(new ContainerBuilder().setAccentColor(COLORS.idle).addTextDisplayComponents(text(content)));
}

/** Ephemeral reply carrying someone's personal site link. */
export function joinView(url: string, name: string) {
  return {
    content: `Your personal link — anyone who opens it appears in the room as **${esc(name)}**.`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel("Open watch session"),
      ),
    ],
  };
}
