import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCORD_DOWN_EXIT_MS, healthStatus, setDiscordProbe, shouldRestart, startWatchdog } from "../src/health.js";
import { connectedBrowsers, getOrCreateSessionForGuild, resetStore } from "../src/watchtogether/store.js";
import type { WebSocket } from "ws";

afterEach(() => {
  vi.useRealTimers();
  resetStore();
  setDiscordProbe(() => false);
});

describe("shouldRestart", () => {
  it("waits until Discord has been down long enough", () => {
    expect(shouldRestart(undefined, 1e9, 0)).toBe(false);
    expect(shouldRestart(0, DISCORD_DOWN_EXIT_MS - 1, 0)).toBe(false);
    expect(shouldRestart(0, DISCORD_DOWN_EXIT_MS, 0)).toBe(true);
  });

  it("never restarts while a browser is connected", () => {
    expect(shouldRestart(0, DISCORD_DOWN_EXIT_MS * 10, 1)).toBe(false);
  });
});

describe("healthStatus", () => {
  it("reports Discord and the number of browsers", () => {
    getOrCreateSessionForGuild("g").clients.add({ close: () => {} } as unknown as WebSocket);
    expect(connectedBrowsers()).toBe(1);
    expect(healthStatus()).toEqual({ ok: false, discord: false, browsers: 1 });
    setDiscordProbe(() => true);
    expect(healthStatus()).toEqual({ ok: true, discord: true, browsers: 1 });
  });
});

describe("startWatchdog", () => {
  it("exits once Discord stays down with nobody watching, not before", () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const timer = startWatchdog(exit);
    vi.advanceTimersByTime(DISCORD_DOWN_EXIT_MS - 30_000);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(exit).toHaveBeenCalledOnce();
    clearInterval(timer);
  });

  it("resets the clock when Discord comes back", () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const timer = startWatchdog(exit);
    vi.advanceTimersByTime(DISCORD_DOWN_EXIT_MS - 30_000);
    setDiscordProbe(() => true);
    vi.advanceTimersByTime(30_000);
    setDiscordProbe(() => false);
    vi.advanceTimersByTime(DISCORD_DOWN_EXIT_MS - 30_000);
    expect(exit).not.toHaveBeenCalled();
    clearInterval(timer);
  });
});
