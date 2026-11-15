// The action log: one small line per change worth keeping in chat (queueing,
// clearing, shuffling, autoplay, the queue running out), posted in the live
// player's channel just above the player. Passing actions (skips, pauses, queue
// tweaks) go to the player's footer instead. Slash commands answer with their
// own line (their actions arrive silent); this covers buttons, the site and
// automatic events. Quick repeats by the same person edit the last line
// instead of posting a new one.
import type { Message, SendableChannels } from "discord.js";
import { logger } from "../logger.js";
import { type LastAction, onAction, type Session } from "../watchtogether/session.js";
import { isTransient, lineText, merges, type Stack, stack } from "./lines.js";
import { followLogLine, livePlayer } from "./player.js";
import { noteRecent } from "./recent.js";

interface Line extends Stack {
  message: Message;
}

const lastLines = new Map<string, Line>();
const chains = new Map<string, Promise<unknown>>();
const noPings = { parse: [] };

/** True when nothing but the live player was posted after `message`. */
async function onlyPlayerAfter(message: Message): Promise<boolean> {
  if (!message.channel.isSendable()) return false;
  const newer = await message.channel.messages.fetch({ after: message.id, limit: 5 }).catch(() => undefined);
  if (!newer) return false;
  const playerId = livePlayer(message.guildId ?? "")?.id;
  return newer.every((m) => m.id === playerId);
}

/** Posts or merges a line; resolves true when a new line was posted. */
async function write(guildId: string, channel: SendableChannels, action: LastAction): Promise<boolean> {
  const previous = lastLines.get(guildId);
  if (
    merges(previous, action) &&
    previous.message.channelId === channel.id &&
    (await onlyPlayerAfter(previous.message))
  ) {
    const next = stack(action, previous);
    const edited = await previous.message
      .edit({ content: lineText(next.action, next.titles), allowedMentions: noPings })
      .then(() => true)
      .catch(() => false);
    if (edited) {
      Object.assign(previous, next);
      return false;
    }
  }

  const line = stack(action);
  const message = await channel.send({ content: lineText(line.action, line.titles), allowedMentions: noPings });
  lastLines.set(guildId, { ...line, message });
  return true;
}

function logAction(session: Session, action: LastAction): void {
  const channel = livePlayer(session.guildId)?.channel;
  if (!channel?.isSendable()) return; // no player yet → nowhere to log
  const { guildId } = session;
  // One line at a time per guild, so merges see the line before them.
  const posted = (chains.get(guildId) ?? Promise.resolve())
    .then(() => write(guildId, channel, action))
    .catch((err: unknown) => {
      logger.warn({ err, guildId }, "failed to write action log line");
      return false;
    });
  chains.set(guildId, posted);
  // Same tick as the session change, so the player moves once, below the line.
  void followLogLine(session, posted);
}

/**
 * Starts reporting actions: passing ones on the player's footer (silent or
 * not, since a slash command's reply for those is private), the rest as log
 * lines unless silent.
 */
export function startActionLog(): () => void {
  return onAction((session, action, silent) => {
    if (isTransient(action)) noteRecent(session.guildId, action);
    else if (!silent) logAction(session, action);
  });
}
