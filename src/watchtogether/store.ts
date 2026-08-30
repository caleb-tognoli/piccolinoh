import { createSession, type Session, type SessionSettings } from "./session.js";

const sessions = new Map<string, Session>();
const guildIndex = new Map<string, string>();

type SettingsLoader = (guildId: string) => Partial<SessionSettings>;

let settingsLoader: SettingsLoader = () => ({});

export function setSettingsLoader(fn: SettingsLoader): void {
  settingsLoader = fn;
}

export function createSessionInStore(guildId: string): Session {
  const session = createSession(guildId);
  Object.assign(session.settings, settingsLoader(guildId));
  sessions.set(session.id, session);
  guildIndex.set(guildId, session.id);
  return session;
}

export function updateSessionSettingsForGuild(
  guildId: string,
  patch: Partial<SessionSettings>,
): void {
  const sessionId = guildIndex.get(guildId);
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (!session) return;
  Object.assign(session.settings, patch);
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
