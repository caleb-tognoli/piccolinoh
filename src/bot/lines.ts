// What a reported action looks like as a line of text, shared by the action
// log and the player's footer: which actions are worth keeping in chat, and how
// quick repeats by the same person stack into one line.
import type { LastAction } from "../watchtogether/session.js";
import { describe, esc, logLine } from "./views.js";

/** How long after a line the same person's next action may merge into it. */
export const MERGE_WINDOW_MS = 30_000;
const STACK_SHOWN = 4;

/**
 * Actions that only describe the moment (playback and queue tweaks). They show
 * on the player's footer instead of posting a line; the rest change what's
 * coming up and stay in chat.
 */
const TRANSIENT = new Set<LastAction["kind"]>([
  "play",
  "pause",
  "skip",
  "start",
  "autoSkip",
  "seek",
  "reorder",
  "remove",
  "restore",
]);

export function isTransient(action: LastAction): boolean {
  return TRANSIENT.has(action.kind);
}

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
      return action.count === 1 && !action.next ? "enqueue" : undefined;
    case "reorder":
      return `reorder:${action.title}`; // the line shows the latest position
    case "seek":
      return `seek:${action.title}`; // arrow-key taps collapse into the latest spot
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

/** One line's worth of actions: the latest one, and every title stacked so far. */
export interface Stack {
  action: LastAction;
  group: string | undefined;
  titles: string[];
  at: number;
}

/** Whether `action` may merge into the line `previous` shows. */
export function merges(previous: Stack | undefined, action: LastAction, nowMs = Date.now()): previous is Stack {
  const group = mergeGroup(action);
  return (
    previous !== undefined &&
    group !== undefined &&
    previous.group === group &&
    previous.action.by === action.by &&
    nowMs - previous.at < MERGE_WINDOW_MS
  );
}

/** `action` as a new line, or stacked onto `previous`. */
export function stack(action: LastAction, previous?: Stack, nowMs = Date.now()): Stack {
  const title = STACK_VERBS[action.kind] && "title" in action ? action.title : undefined;
  const earlier = previous?.titles ?? [];
  return { action, group: mergeGroup(action), titles: title ? [...earlier, title] : earlier, at: nowMs };
}
