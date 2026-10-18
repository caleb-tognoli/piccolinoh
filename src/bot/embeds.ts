import { EmbedBuilder } from "discord.js";
import type { CurrentTrack, Session, Track } from "../watchtogether/session.js";

const COLORS = {
  ok: 0x53c47a,
  info: 0x8a7ee6,
  queued: 0x4c8bf5,
  error: 0xd05656,
} as const;

const LIST_LIMIT = 10;

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function line(track: Track): string {
  return `**${track.title}** · ${formatDuration(track.durationSec)}`;
}

function thumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Joins up to LIST_LIMIT lines, staying under Discord's 1024-char field limit. */
function list(lines: string[]): string {
  let out = "";
  let shown = 0;
  for (const l of lines.slice(0, LIST_LIMIT)) {
    if (out.length + l.length > 950) break;
    out += (shown++ ? "\n" : "") + l;
  }
  return lines.length > shown ? `${out}\n_+ ${lines.length - shown} more_` : out;
}

export function ok(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(COLORS.ok).setTitle(title);
  return description ? e.setDescription(description) : e;
}

export function info(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.info).setTitle(title).setDescription(description);
}

export function error(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.error).setTitle("Error").setDescription(message);
}

export function queued(track: Track, startedNow: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.queued)
    .setAuthor({ name: startedNow ? "Playing" : "Queued" })
    .setTitle(track.title)
    .setDescription(`${track.author} · ${formatDuration(track.durationSec)}`)
    .setThumbnail(thumbnail(track.videoId));
}

export function queuedMany(count: number, name: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.queued)
    .setAuthor({ name: "Queued" })
    .setTitle(name)
    .setDescription(`${count} track${count === 1 ? "" : "s"} added to the queue.`);
}

export function nowPlaying(current: CurrentTrack): EmbedBuilder {
  const paused = current.pausedAtPositionSec != null;
  return new EmbedBuilder()
    .setColor(COLORS.ok)
    .setAuthor({ name: paused ? "Paused" : "Now playing" })
    .setTitle(current.title)
    .setDescription(`${current.author} · ${formatDuration(current.durationSec)}`)
    .setThumbnail(thumbnail(current.videoId));
}

/** Now playing + up next. Used by /queue and the live board posted by /play. */
export function queueList(session: Session): EmbedBuilder {
  const { current, queue } = session;
  const nowValue = current
    ? `${line(current)} — ${current.author}${current.pausedAtPositionSec != null ? " · ⏸" : ""}`
    : "_Nothing playing_";
  const upNext = queue.length > 0 ? list(queue.map((t, i) => `${i + 1}. ${line(t)}`)) : "_Queue empty_";
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle("Queue")
    .addFields({ name: "▶ Now playing", value: nowValue }, { name: "Up next", value: upNext });
}

export function historyList(history: Track[]): EmbedBuilder {
  const lines = history
    .slice(-LIST_LIMIT)
    .reverse()
    .map((t) => `• ${line(t)}`)
    .join("\n");
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle("Recently played")
    .setDescription(lines || "_Nothing has played yet._");
}
