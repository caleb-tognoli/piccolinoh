// A live "Queue" message per guild, posted by /play and edited on every
// session change. Deleted once nothing is playing or queued.
import type { GuildTextBasedChannel, Message } from "discord.js";
import { logger } from "../logger.js";
import { onSessionChange, type Session } from "../watchtogether/session.js";
import { queueList } from "./embeds.js";

const boards = new Map<string, { message: Message; unsubscribe: () => void }>();

function drop(guildId: string, message: Message): void {
  const board = boards.get(guildId);
  if (board?.message !== message) return;
  board.unsubscribe();
  boards.delete(guildId);
}

export async function showBoard(channel: GuildTextBasedChannel, session: Session): Promise<void> {
  const existing = boards.get(session.guildId);
  if (existing) {
    // Still editable → the change listener already keeps it fresh.
    const alive = await existing.message.edit({ embeds: [queueList(session)] }).then(
      () => true,
      () => false,
    );
    if (alive) return;
    drop(session.guildId, existing.message);
  }

  const message = await channel.send({ embeds: [queueList(session)] });
  const unsubscribe = onSessionChange((s) => {
    if (s.id !== session.id) return;
    if (!s.current && s.queue.length === 0) {
      drop(s.guildId, message);
      message.delete().catch(() => {});
      return;
    }
    message.edit({ embeds: [queueList(s)] }).catch((err: unknown) => {
      logger.warn({ err, guildId: s.guildId }, "board message not editable — dropping");
      drop(s.guildId, message);
    });
  });
  boards.set(session.guildId, { message, unsubscribe });
}
