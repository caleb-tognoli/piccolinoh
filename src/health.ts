// Whether the process is healthy, and a watchdog that restarts it when the
// Discord connection is gone for good. Rooms are saved on exit, but the
// watchdog still only exits while no browser is watching: a room keeps working
// without Discord, and a restart would pause everyone's video.
import { logger } from "./logger.js";
import { connectedBrowsers } from "./watchtogether/store.js";

/** How long Discord may be unreachable before an idle process restarts itself. */
export const DISCORD_DOWN_EXIT_MS = 5 * 60_000;
const CHECK_EVERY_MS = 30_000;

let discordUp: () => boolean = () => false;

/** Set once the bot exists; until then Discord counts as down. */
export function setDiscordProbe(probe: () => boolean): void {
  discordUp = probe;
}

export function healthStatus(): { ok: boolean; discord: boolean; browsers: number } {
  const discord = discordUp();
  return { ok: discord, discord, browsers: connectedBrowsers() };
}

/** Restart once Discord has been down long enough and nobody would notice. */
export function shouldRestart(downSinceMs: number | undefined, nowMs: number, browsers: number): boolean {
  return downSinceMs !== undefined && nowMs - downSinceMs >= DISCORD_DOWN_EXIT_MS && browsers === 0;
}

/** Exits the process (Docker's restart policy brings it back) per `shouldRestart`. */
export function startWatchdog(exit: () => void = () => process.exit(1)): NodeJS.Timeout {
  let downSince: number | undefined = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    if (discordUp()) {
      downSince = undefined;
      return;
    }
    downSince ??= now;
    if (shouldRestart(downSince, now, connectedBrowsers())) {
      logger.fatal({ downForMs: now - downSince }, "discord unreachable and no one watching: restarting");
      exit();
    }
  }, CHECK_EVERY_MS);
  timer.unref();
  return timer;
}
