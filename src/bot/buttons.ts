// Button clicks on the player and on the private /queue and /history views.
// Clicks answer privately or by updating their own message; what they change
// reaches the channel through the action log.
import type { ButtonInteraction } from "discord.js";
import { applyControl, type ControlAction } from "../watchtogether/control.js";
import type { LastAction, Session } from "../watchtogether/session.js";
import { ephemeral, joinReply, type Outcome, pause, queueReply, resume, skip } from "./commands.js";
import { adoptPlayer, livePlayer } from "./player.js";
import { describe, historyView, ID, type QueueOp, queueView, stalePlayerView } from "./views.js";

type Click = ButtonInteraction<"cached">;

/** Feedback line for a private view: "Moved **X** to #1". */
function notice(action: LastAction | undefined): string | undefined {
  if (!action) return undefined;
  const phrase = describe(action);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

async function onPlayer(click: Click, session: Session, op: string): Promise<unknown> {
  const name = click.member.displayName;
  if (op === "join") return click.reply(joinReply(session, name));
  if (op === "queue") return click.reply(queueReply(session));

  const live = livePlayer(click.guildId);
  // No player tracked (e.g. after a restart): this message becomes the live one,
  // before the change, so its log line lands in this channel.
  if (!live) adoptPlayer(click.message, session);

  let outcome: Outcome;
  if (op === "toggle") {
    outcome = session.current?.pausedAtPositionSec != null ? resume(session, { by: name }) : pause(session, { by: name });
  } else if (op === "skip") {
    outcome = skip(session, { by: name });
  } else {
    return undefined;
  }
  const error = typeof outcome === "string" ? outcome : undefined;

  if (live && live.id !== click.message.id) {
    // A leftover player; the change still applied to the live one.
    await click.update(stalePlayerView());
    return error ? click.followUp(ephemeral(error)) : undefined;
  }
  return error ? click.reply(ephemeral(error)) : click.deferUpdate();
}

const queueMoves: Record<QueueOp, (index: number) => ControlAction> = {
  top: (index) => ({ kind: "reorder", from: index, to: 0 }),
  up: (index) => ({ kind: "reorder", from: index, to: index - 1 }),
  down: (index) => ({ kind: "reorder", from: index, to: index + 1 }),
  rm: (index) => ({ kind: "remove", index }),
};

function onQueue(click: Click, session: Session, op: string, args: string[]): Promise<unknown> {
  const page = Number(args[0]);
  if (op === "page") return click.update(queueView(session, page));
  const move = queueMoves[op as QueueOp];
  if (!move) return Promise.resolve();

  const index = Number(args[1]);
  const action = move(index);
  const target = action.kind === "reorder" ? action.to : index;
  // Buttons name the track they were drawn for; refuse if the queue moved underneath.
  if (session.queue[index]?.videoId !== args[2] || target < 0 || target >= session.queue.length) {
    return click.update(queueView(session, page, "Queue changed — refreshed"));
  }
  const done = applyControl(session, action, { by: click.member.displayName });
  return click.update(queueView(session, page, notice(done)));
}

function onHistory(click: Click, session: Session, op: string, args: string[]): Promise<unknown> {
  const page = Number(args[0]);
  if (op === "page") return click.update(historyView(session, page));
  if (op !== "add") return Promise.resolve();

  const track = session.history[Number(args[1])];
  if (!track || track.videoId !== args[2]) {
    return click.update(historyView(session, page, "History changed — refreshed"));
  }
  const done = applyControl(session, { kind: "enqueue", tracks: [track] }, { by: click.member.displayName });
  return click.update(historyView(session, page, notice(done)));
}

export function handleButton(click: Click, session: Session): Promise<unknown> {
  const [prefix, op = "", ...args] = click.customId.split(":");
  switch (prefix) {
    case ID.player:
      return onPlayer(click, session, op);
    case ID.queue:
      return onQueue(click, session, op, args);
    case ID.history:
      return onHistory(click, session, op, args);
    default:
      return Promise.resolve();
  }
}
