// The player's footer: the latest passing action (a skip, a pause, a queue
// tweak), shown on the player instead of as a line in chat. Quick repeats by
// the same person stack, like log lines do, and the footer clears itself a
// while after the last one.
import type { LastAction } from "../watchtogether/session.js";
import { lineText, merges, type Stack, stack } from "./lines.js";

/** How long the footer shows an action. */
export const RECENT_SHOWN_MS = 2 * 60_000;

const recent = new Map<string, Stack>();

export function noteRecent(guildId: string, action: LastAction, nowMs = Date.now()): void {
  const previous = recent.get(guildId);
  recent.set(guildId, stack(action, merges(previous, action, nowMs) ? previous : undefined, nowMs));
}

/** Whether a footer is showing (or due to be cleared). */
export function hasRecent(guildId: string): boolean {
  return recent.has(guildId);
}

/** The footer line, "-# Caleb skipped **A** · <t:…:R>", or undefined once it has expired. */
export function recentLine(guildId: string, nowMs = Date.now()): string | undefined {
  const line = recent.get(guildId);
  if (!line) return undefined;
  if (nowMs - line.at >= RECENT_SHOWN_MS) {
    recent.delete(guildId);
    return undefined;
  }
  return `${lineText(line.action, line.titles)} · <t:${Math.floor(line.at / 1000)}:R>`;
}
