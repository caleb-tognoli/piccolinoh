import { createSession, type Session } from "./session.js";

const sessions = new Map<string, Session>();
const guildIndex = new Map<string, string>();

export function createSessionInStore(guildId: string): Session {
  const session = createSession(guildId);
  sessions.set(session.id, session);
  guildIndex.set(guildId, session.id);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function getOrCreateSessionForGuild(guildId: string): Session {
  const existingId = guildIndex.get(guildId);
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing) return existing;
    guildIndex.delete(guildId);
  }
  return createSessionInStore(guildId);
}

export function destroySession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  if (session.advanceTimer) {
    clearTimeout(session.advanceTimer);
    session.advanceTimer = undefined;
  }
  for (const ws of session.clients) {
    try {
      ws.close(1000, "session destroyed");
    } catch {
      // ignore
    }
  }
  guildIndex.delete(session.guildId);
  sessions.delete(id);
}

export function resetStore(): void {
  for (const id of [...sessions.keys()]) {
    destroySession(id);
  }
}
