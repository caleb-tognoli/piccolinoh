import type { Client, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { logger } from "../logger.js";
import type { SerializedSession } from "../watchtogether/index.js";
import { subscribeToSession } from "../watchtogether/index.js";
import { getVideoMetadata } from "./resolver.js";

interface NowPlayingEntry {
  channelId: string;
  messageId: string;
  unsubscribe: () => void;
}

const nowPlayingByGuild = new Map<string, NowPlayingEntry>();

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function describeTrack(videoId: string, durationSec: number): string {
  const meta = getVideoMetadata(videoId);
  if (meta) {
    return `**${meta.title}**\n${meta.author} · ${formatDuration(durationSec)}`;
  }
  return `\`${videoId}\` · ${formatDuration(durationSec)}`;
}

function buildEmbed(session: SerializedSession): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0xe8935c).setTitle("▶ Now Playing");
  if (session.current) {
    embed.setDescription(describeTrack(session.current.videoId, session.current.durationSec));
  } else {
    embed.setDescription("_Nothing playing_");
  }
  if (session.queue.length > 0) {
    const shown = session.queue.slice(0, 5);
    const upNext = shown
      .map((item, i) => {
        const meta = getVideoMetadata(item.videoId);
        const title = meta ? meta.title : item.videoId;
        return `${i + 1}. ${title} · ${formatDuration(item.durationSec)}`;
      })
      .join("\n");
    const more = session.queue.length - shown.length;
    embed.addFields({
      name: "Up next",
      value: upNext + (more > 0 ? `\n_+ ${more} more_` : ""),
    });
  }
  embed.setFooter({ text: `session: ${session.id}` });
  return embed;
}

async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
  return channel as TextChannel;
}

async function editEmbed(
  client: Client,
  entry: NowPlayingEntry,
  session: SerializedSession,
): Promise<boolean> {
  const channel = await fetchTextChannel(client, entry.channelId);
  if (!channel) return false;
  try {
    const message = await channel.messages.fetch(entry.messageId);
    await message.edit({ embeds: [buildEmbed(session)] });
    return true;
  } catch (err) {
    logger.warn({ err, guildId: session.guildId }, "now-playing message not editable — clearing");
    return false;
  }
}

async function deleteEmbed(client: Client, entry: NowPlayingEntry): Promise<void> {
  const channel = await fetchTextChannel(client, entry.channelId);
  if (!channel) return;
  try {
    const message = await channel.messages.fetch(entry.messageId);
    await message.delete();
  } catch {
    // already gone
  }
}

export async function ensureNowPlaying(
  client: Client,
  session: SerializedSession,
  channelId: string,
): Promise<void> {
  const existing = nowPlayingByGuild.get(session.guildId);
  if (existing) {
    const edited = await editEmbed(client, existing, session);
    if (edited) return;
    // Message was deleted — fall through to post fresh in the current channelId.
    existing.unsubscribe();
    nowPlayingByGuild.delete(session.guildId);
  }

  const channel = await fetchTextChannel(client, channelId);
  if (!channel) {
    logger.warn({ guildId: session.guildId, channelId }, "cannot post now-playing: no text channel");
    return;
  }

  const message = await channel.send({ embeds: [buildEmbed(session)] });
  const guildId = session.guildId;
  const unsubscribe = subscribeToSession(session.id, (s) => {
    if (!s.current && s.queue.length === 0) {
      const entry = nowPlayingByGuild.get(guildId);
      if (!entry) return;
      entry.unsubscribe();
      nowPlayingByGuild.delete(guildId);
      void deleteEmbed(client, entry);
      return;
    }
    void (async () => {
      const entry = nowPlayingByGuild.get(guildId);
      if (!entry) return;
      const ok = await editEmbed(client, entry, s);
      if (!ok) {
        entry.unsubscribe();
        nowPlayingByGuild.delete(guildId);
      }
    })();
  });

  nowPlayingByGuild.set(session.guildId, {
    channelId,
    messageId: message.id,
    unsubscribe,
  });
}
