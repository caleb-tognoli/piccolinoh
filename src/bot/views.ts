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
} as const;

export type PlayerOp = "toggle" | "skip" | "join";
export type QueueOp = "top" | "up" | "down" | "rm";

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
  return `**${esc(track.title)}** — ${esc(track.author)} · ${formatDuration(track.durationSec)}`;
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
      if (action.count > 1) {
        const from = action.title ? ` from **${esc(action.title)}**` : "";
        return `queued ${action.count} tracks${from}${action.next ? " to play next" : ""}`;
      }
      if (action.next) return `queued **${esc(action.title)}** to play next`;
      const at = action.position ? ` (#${action.position})` : "";
      return `queued **${esc(action.title)}**${at}`;
    }
    case "remove":
      return `removed **${esc(action.title)}**`;
    case "restore":
      return `restored **${esc(action.title)}**`;
    case "reorder":
      return `moved **${esc(action.title)}** to #${action.to}`;
    case "clear":
      return `cleared ${action.count} track${action.count === 1 ? "" : "s"}`;
    case "shuffle":
      return `shuffled ${action.count} tracks`;
    case "autoplay":
      return `turned autoplay ${action.enabled ? "on" : "off"}`;
  }
}

function capitalize(text: string): string {
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

function upNext(queue: Track[]): string {
  const [next] = queue;
  if (!next) return "-# Queue empty";
  const more = queue.length > 1 ? ` · +${queue.length - 1} more` : "";
  return `Up next: **${esc(next.title)}**${more}`;
}

const joinButton = () => button(`${ID.player}:join`, "🔗 Join");
const queueButton = () => button(`${ID.player}:queue`, "📋 Queue");

/** The live player: what's playing and how far in, a peek at the queue, and controls. */
export function playerView(session: Session, nowMs = Date.now()): V2Message {
  const { current, queue, autoplay } = session;
  const container = new ContainerBuilder();

  if (current) {
    const paused = current.pausedAtPositionSec != null;
    container.setAccentColor(paused ? COLORS.paused : COLORS.playing);
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            [
              `-# ${paused ? "⏸ Paused" : "▶ Now playing"}`,
              `**[${esc(current.title)}](https://youtu.be/${current.videoId})**`,
              esc(current.author),
            ].join("\n"),
          ),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail(current.videoId))),
    );
    const details = [progressBar(derivePosition(session, nowMs), current.durationSec), upNext(queue)];
    if (!autoplay) details.push("-# Autoplay off · stops after this track");
    container.addTextDisplayComponents(text(details.join("\n")));
    container.addActionRowComponents(
      row(
        paused
          ? button(`${ID.player}:toggle`, "▶ Resume", ButtonStyle.Primary)
          : button(`${ID.player}:toggle`, "⏸ Pause"),
        button(`${ID.player}:skip`, "⏭ Skip"),
        queueButton(),
        joinButton(),
      ),
    );
    return v2(container);
  }

  container.setAccentColor(COLORS.idle);
  if (queue.length > 0) {
    // Autoplay stopped after a track; the queue is waiting.
    const lines = ["-# ⏹ Stopped", upNext(queue)];
    if (!autoplay) lines.push("-# Autoplay off");
    container.addTextDisplayComponents(text(lines.join("\n")));
    container.addActionRowComponents(
      row(button(`${ID.player}:skip`, "▶ Play next", ButtonStyle.Primary), queueButton(), joinButton()),
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

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function clampPage(page: number, total: number): number {
  return Math.min(Math.max(0, page), pageCount(total) - 1);
}

function pager(prefix: string, page: number, total: number): ActionRowBuilder<ButtonBuilder> {
  const pages = pageCount(total);
  const buttons: ButtonBuilder[] = [];
  if (pages > 1) {
    buttons.push(
      button(`${prefix}:page:${page - 1}:prev`, "◀").setDisabled(page === 0),
      button(`${prefix}:page:${page}:at`, `${page + 1}/${pages}`).setDisabled(true),
      button(`${prefix}:page:${page + 1}:next`, "▶").setDisabled(page >= pages - 1),
    );
  }
  buttons.push(button(`${prefix}:page:${page}:refresh`, "↻ Refresh"));
  return row(...buttons);
}

function totalDuration(tracks: Track[]): string {
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
  container.addTextDisplayComponents(text(header.join("\n")));

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
        button(id("top"), "⏫ Next").setDisabled(first),
        button(id("up"), "▲").setDisabled(first),
        button(id("down"), "▼").setDisabled(last),
        button(id("rm"), "✕", ButtonStyle.Danger),
      ),
    );
  });

  container.addActionRowComponents(pager(ID.queue, page, queue.length));
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
  container.addTextDisplayComponents(text(header.join("\n")));

  const start = page * PAGE_SIZE;
  for (let i = start; i < Math.min(start + PAGE_SIZE, history.length); i++) {
    const index = history.length - 1 - i;
    const track = history[index]!;
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(trackLine(track)))
        .setButtonAccessory(button(`${ID.history}:add:${page}:${index}:${track.videoId}`, "+ Queue")),
    );
  }

  if (history.length > 0) container.addActionRowComponents(pager(ID.history, page, history.length));
  return v2(container);
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
