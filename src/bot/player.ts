// The live player: one message per guild, kept below the action log.
// Whenever what it shows changes it is re-posted at the bottom (the old one
// deleted) rather than edited, so Discord never marks it "(edited)". Its
// timeline is a Discord timestamp that counts down by itself, so playing on
// needs no updates. It's only edited where the bot can't post (a player sent
// as a command's follow-up).
// All work for a guild runs one job at a time, and jobs queued in the same
// tick coalesce, so a change plus its re-post is one post.
import type { Message, SendableChannels } from "discord.js";
import { logger } from "../logger.js";
import { onSessionChange, type Session } from "../watchtogether/session.js";
import { playerView } from "./views.js";

/** `auto` re-posts the player when its render changed; `repost` always does. */
type Mode = "auto" | "repost";

interface Live {
  message: Message;
  session: Session;
  rendered: string;
}

interface Job {
  mode: Mode;
  session: Session;
  channel?: SendableChannels;
  /** Work that must land first (a log line); resolving true means it posted below the player. */
  before: Promise<boolean>[];
  waiters: ((ok: boolean) => void)[];
}

const live = new Map<string, Live>();
const pending = new Map<string, Job>();
const running = new Set<string>();

function render(session: Session) {
  const view = playerView(session);
  return { view, key: JSON.stringify(view.components.map((c) => c.toJSON())) };
}

function schedule(
  session: Session,
  mode: Mode,
  channel?: SendableChannels,
  before?: Promise<boolean>,
): Promise<boolean> {
  const { guildId } = session;
  let job = pending.get(guildId);
  if (!job) {
    job = { mode, session, before: [], waiters: [] };
    pending.set(guildId, job);
    setImmediate(() => void drain(guildId));
  } else if (mode === "repost") {
    job.mode = mode;
  }
  if (channel) job.channel = channel;
  if (before) job.before.push(before);
  const waiters = job.waiters;
  return new Promise((resolve) => waiters.push(resolve));
}

async function drain(guildId: string): Promise<void> {
  if (running.has(guildId)) return; // the running loop picks the job up
  running.add(guildId);
  try {
    for (let job = pending.get(guildId); job; job = pending.get(guildId)) {
      pending.delete(guildId);
      const ok = await run(job).catch((err: unknown) => {
        logger.warn({ err, guildId }, "player update failed");
        return false;
      });
      for (const resolve of job.waiters) resolve(ok);
    }
  } finally {
    running.delete(guildId);
  }
}

async function post(session: Session, channel: SendableChannels): Promise<boolean> {
  const { view, key } = render(session);
  const message = await channel.send(view).catch((err: unknown) => {
    logger.warn({ err, guildId: session.guildId }, "failed to post player");
    return undefined;
  });
  if (!message) return false;
  replace(session, message, key);
  return true;
}

/** Makes `message` the live player, deleting the previous one. */
function replace(session: Session, message: Message, rendered: string): void {
  const previous = live.get(session.guildId);
  live.set(session.guildId, { message, session, rendered });
  if (previous && previous.message.id !== message.id) previous.message.delete().catch(() => {});
}

async function run(job: Job): Promise<boolean> {
  const { session } = job;
  const moved = await Promise.all(job.before.map((p) => p.catch(() => false)));
  const mode = moved.some(Boolean) ? "repost" : job.mode;
  const current = live.get(session.guildId);
  const channel = job.channel ?? (current?.message.channel.isSendable() ? current.message.channel : undefined);
  if (mode === "repost") return channel ? post(session, channel) : false;
  if (!current) return true;

  const { view, key } = render(session);
  if (key === current.rendered) return true;
  if (channel && (await post(session, channel))) return true;
  // Can't post here: keep the player current in place instead.
  try {
    await current.message.edit(view);
    current.rendered = key;
    return true;
  } catch (err) {
    logger.warn({ err, guildId: session.guildId }, "player message not editable — dropping");
    if (live.get(session.guildId) === current) live.delete(session.guildId);
    return false;
  }
}

onSessionChange((session) => {
  if (live.has(session.guildId)) void schedule(session, "auto");
});

/**
 * Posts the player at the bottom of `channel`, replacing the old one, once
 * `before` (e.g. the command's reply) has landed. Call it in the same tick as
 * the change it shows, so the two coalesce. Resolves false when it can't post.
 */
export function postPlayer(
  channel: SendableChannels,
  session: Session,
  before?: Promise<unknown>,
): Promise<boolean> {
  return schedule(session, "repost", channel, before?.then(() => true));
}

/** Updates the player after a log line lands, moving it below the line when one was posted. */
export function followLogLine(session: Session, posted: Promise<boolean>): Promise<boolean> {
  return schedule(session, "auto", undefined, posted);
}

/**
 * Makes an existing message the live player: an interaction reply just
 * rendered from `session`, or (`upToDate` false) a player from before a
 * restart, which is re-posted with what it should show now.
 */
export function adoptPlayer(message: Message, session: Session, upToDate = true): void {
  replace(session, message, upToDate ? render(session).key : "");
  if (!upToDate) void schedule(session, "auto");
}

export function livePlayer(guildId: string): Message | undefined {
  return live.get(guildId)?.message;
}
