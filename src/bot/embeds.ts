import { EmbedBuilder } from "discord.js";
import { getVideoMetadata } from "./resolver.js";

const COLORS = {
  queued: 0x4c8bf5,
  playing: 0x53c47a,
  info: 0x8a7ee6,
  ok: 0x53c47a,
  warn: 0xd6a020,
  error: 0xd05656,
} as const;

const HISTORY_LIMIT = 10;
const QUEUE_LIMIT = 10;

function ytThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function titleFor(videoId: string, fallback = videoId): string {
  const meta = getVideoMetadata(videoId);
  return meta?.title ?? fallback;
}

function authorFor(videoId: string): string | null {
  const meta = getVideoMetadata(videoId);
  return meta?.author ?? null;
}

export function ok(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(COLORS.ok).setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

export function error(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.error).setTitle("Error").setDescription(message);
}

export function info(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(COLORS.info).setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

export function queued(
  track: { videoId: string; title: string; author: string; durationSec: number },
  wasEmpty: boolean,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.queued)
    .setAuthor({ name: wasEmpty ? "Playing" : "Queued" })
    .setTitle(track.title)
    .setDescription(`${track.author} · ${formatDuration(track.durationSec)}`)
    .setThumbnail(ytThumb(track.videoId));
}

export function queuedPlaylist(count: number, sourceLabel: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.queued)
    .setAuthor({ name: "Queued" })
    .setTitle(sourceLabel)
    .setDescription(`${count} track${count === 1 ? "" : "s"} added to the queue.`);
}

export function nowPlaying(
  current: { videoId: string; durationSec: number },
  paused: boolean,
): EmbedBuilder {
  const meta = getVideoMetadata(current.videoId);
  const title = meta?.title ?? current.videoId;
  const author = meta?.author ?? null;
  const dur = formatDuration(current.durationSec);
  const description = [author, dur, paused ? "⏸ paused" : null].filter(Boolean).join(" · ");
  return new EmbedBuilder()
    .setColor(COLORS.playing)
    .setAuthor({ name: paused ? "Paused" : "Now playing" })
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(ytThumb(current.videoId));
}

export function queueList(
  items: { videoId: string; durationSec: number }[],
  current?: { videoId: string; durationSec: number } | undefined,
): EmbedBuilder {
  const e = new EmbedBuilder().setColor(COLORS.info).setTitle("Queue");
  if (current) {
    const author = authorFor(current.videoId);
    e.addFields({
      name: "▶ Now playing",
      value: `**${titleFor(current.videoId)}**${author ? ` — ${author}` : ""} · ${formatDuration(current.durationSec)}`,
    });
  } else {
    e.addFields({ name: "▶ Now playing", value: "_Nothing playing_" });
  }
  if (items.length === 0) {
    e.addFields({ name: "Up next", value: "_Queue empty_" });
  } else {
    const shown = items.slice(0, QUEUE_LIMIT);
    const lines = shown
      .map((it, i) => `${i + 1}. **${titleFor(it.videoId)}** · ${formatDuration(it.durationSec)}`)
      .join("\n");
    const more = items.length > QUEUE_LIMIT ? `\n_+ ${items.length - QUEUE_LIMIT} more_` : "";
    e.addFields({ name: "Up next", value: lines + more });
  }
  return e;
}

export function historyList(
  items: { videoId: string; durationSec: number }[],
): EmbedBuilder {
  const e = new EmbedBuilder().setColor(COLORS.info).setTitle("Recently played");
  if (items.length === 0) {
    e.setDescription("_Nothing has played yet._");
    return e;
  }
  const shown = items.slice(-HISTORY_LIMIT).reverse();
  const lines = shown
    .map((it) => `• **${titleFor(it.videoId)}** · ${formatDuration(it.durationSec)}`)
    .join("\n");
  e.setDescription(lines);
  return e;
}
