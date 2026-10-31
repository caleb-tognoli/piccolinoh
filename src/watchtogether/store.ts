import { createSession, type Session } from "./session.js";

const sessionsById = new Map<string, Session>();
const sessionsByGuild = new Map<string, Session>();

export function getSession(id: string): Session | undefined {
  return sessionsById.get(id);
}

export function getOrCreateSessionForGuild(guildId: string): Session {
  let session = sessionsByGuild.get(guildId);
  if (!session) {
    session = createSession(guildId);
    sessionsById.set(session.id, session);
    sessionsByGuild.set(guildId, session);
  }
  return session;
}

/** Test helper: drops every session, stopping timers and closing sockets. */
export function resetStore(): void {
  for (const session of sessionsById.values()) {
    clearTimeout(session.advanceTimer);
    for (const ws of session.clients) ws.close(1000, "session destroyed");
  }
  sessionsById.clear();
  sessionsByGuild.clear();
}
