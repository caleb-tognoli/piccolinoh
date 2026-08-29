import { beforeEach, describe, expect, it } from "vitest";
import {
  getOrCreateSessionForGuild,
  getSession,
  resetStore,
} from "../src/watchtogether/store.js";

beforeEach(() => {
  resetStore();
});

describe("getOrCreateSessionForGuild", () => {
  it("creates a fresh session when none exists for the guild", () => {
    const session = getOrCreateSessionForGuild("g1");
    expect(session.guildId).toBe("g1");
    expect(getSession(session.id)).toBe(session);
  });

  it("returns the same session on subsequent calls for the same guild", () => {
    const first = getOrCreateSessionForGuild("g1");
    const second = getOrCreateSessionForGuild("g1");
    expect(second).toBe(first);
    expect(second.id).toBe(first.id);
  });

  it("creates independent sessions per guild", () => {
    const a = getOrCreateSessionForGuild("g1");
    const b = getOrCreateSessionForGuild("g2");
    expect(a.id).not.toBe(b.id);
    expect(a.guildId).toBe("g1");
    expect(b.guildId).toBe("g2");
  });
});
