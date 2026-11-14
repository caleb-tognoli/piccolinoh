// The action log: one small line per thing that happened, posted in the live
// player's channel just above the player. Slash commands answer with their own
// line (their actions arrive silent); this covers buttons, the site and
// automatic events. Quick repeats by the same person edit the last line
// instead of posting a new one.
import type { Message, SendableChannels } from "discord.js";
import { logger } from "../logger.js";
import { type LastAction, onAction, type Session } from "../watchtogether/session.js";
import { followLogLine, livePlayer } from "./player.js";
import { describe, esc, logLine } from "./views.js";

/** How long after a line the same person's next action may merge into it. */
export const MERGE_WINDOW_MS = 30_000;
const STACK_SHOWN = 4;

/** Actions that list their tracks when merged: "removed **A**, **B**". */
const STACK_VERBS: Partial<Record<LastAction["kind"], string>> = {
  skip: "skipped",
  remove: "removed",
  restore: "restored",
  enqueue: "queued",
};

/** Actions with the same group (and the same person) merge; undefined never merges. */
export function mergeGroup(action: LastAction): string | undefined {
  if (!action.by) return undefined;
  switch (action.kind) {
    case "play":
    case "pause":
      return "transport"; // the line shows the latest state
    case "skip":
    case "remove":
    case "restore":
      return action.kind;
    case "enqueue":
      return action.count === 1 ? "enqueue" : undefined;
    case "reorder":
      return `reorder:${action.title}`; // the line shows the latest position
    default:
      return undefined;
  }
}

/** The line for `action`, listing every stacked title when there's more than one. */
export function lineText(action: LastAction, titles: string[]): string {
  const verb = STACK_VERBS[action.kind];
  if (!verb || titles.length < 2) return logLine(describe(action), action.by);
  const shown = titles
    .slice(0, STACK_SHOWN)
    .map((t) => `**${esc(t)}**`)
    .join(", ");
  const more = titles.length > STACK_SHOWN ? ` +${titles.length - STACK_SHOWN} more` : "";
  return logLine(`${verb} ${shown}${more}`, action.by);
}

interface Line {
  message: Message;
  action: LastAction;
  group: string | undefined;
  titles: string[];
  at: number;
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
  const title = STACK_VERBS[action.kind] && "title" in action ? action.title : undefined;
  const group = mergeGroup(action);
  const previous = lastLines.get(guildId);
  if (
    previous &&
    group &&
    previous.group === group &&
    previous.action.by === action.by &&
    Date.now() - previous.at < MERGE_WINDOW_MS &&
    previous.message.channelId === channel.id &&
    (await onlyPlayerAfter(previous.message))
  ) {
    const titles = title ? [...previous.titles, title] : previous.titles;
    const edited = await previous.message
      .edit({ content: lineText(action, titles), allowedMentions: noPings })
      .then(() => true)
      .catch(() => false);
    if (edited) {
      Object.assign(previous, { action, titles, at: Date.now() });
      return false;
    }
  }

  const titles = title ? [title] : [];
  const message = await channel.send({ content: lineText(action, titles), allowedMentions: noPings });
  lastLines.set(guildId, { message, action, group, titles, at: Date.now() });
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

/** Starts logging non-silent actions. */
export function startActionLog(): () => void {
  return onAction((session, action, silent) => {
    if (!silent) logAction(session, action);
  });
}
