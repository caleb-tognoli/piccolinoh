import {
  Columns2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RectangleHorizontal,
  SkipForward,
  SquareStop,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-preact";
import {
  canFullscreen,
  connected,
  fullscreen,
  muted,
  sendControl,
  session,
  setVolume,
  theater,
  toggleFullscreen,
  toggleMute,
  toggleTheater,
  volume,
} from "../store";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";

/** Play/pause and skip for the whole room. */
export function Transport({ class: className }: { class?: string }) {
  const current = session.value?.current;
  if (!current) return null;

  const paused = current.pausedAtPositionSec != null;
  return (
    <fieldset disabled={!connected.value} class={cn("flex items-center gap-1", className)}>
      <Button
        variant="primary"
        icon
        aria-label={paused ? "Play" : "Pause"}
        onClick={() => sendControl({ kind: paused ? "play" : "pause" })}
      >
        {paused ? <Play class="size-5" fill="currentColor" /> : <Pause class="size-5" fill="currentColor" />}
      </Button>
      <Button variant="ghost" icon aria-label="Skip" title="Skip" onClick={() => sendControl({ kind: "skip" })}>
        <SkipForward class="size-5" />
      </Button>
    </fieldset>
  );
}

/**
 * Shown only while autoplay is off (on is the norm); clicking turns it back on
 * for the room. Turning it off stays a deliberate /autoplay in Discord.
 */
export function AutoplayStatus() {
  if (session.value?.autoplay ?? true) return null;
  return (
    <button
      type="button"
      disabled={!connected.value}
      onClick={() => sendControl({ kind: "autoplayOn" })}
      class="group inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/25 focus-visible:outline-2 focus-visible:outline-warning disabled:cursor-default disabled:opacity-60"
      title="The room stops after this video. Click to turn autoplay back on."
    >
      <SquareStop class="size-3.5 shrink-0 group-hover:hidden group-focus-visible:hidden" />
      <Play class="hidden size-3.5 shrink-0 group-hover:block group-focus-visible:block" fill="currentColor" />
      <span class="truncate">Autoplay off</span>
    </button>
  );
}

/**
 * Local only: this browser's mute and volume. The slider slides out on hover or keyboard focus,
 * like YouTube's, and is hidden on phones, where the hardware buttons set volume.
 */
export function VolumeControl() {
  const silent = muted.value || volume.value === 0;
  const level = silent ? 0 : volume.value;
  const Icon = silent ? VolumeX : level < 50 ? Volume1 : Volume2;
  return (
    <div class="group/volume flex items-center">
      <Button
        variant="ghost"
        icon
        aria-label={silent ? "Unmute" : "Mute"}
        title={`${silent ? "Unmute" : "Mute"} (m)`}
        onClick={toggleMute}
      >
        <Icon class="size-5" />
      </Button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={level}
        aria-label="Volume"
        aria-valuetext={`${level}%`}
        class={cn(
          "pointer-events-none hidden h-1 w-0 cursor-pointer accent-accent opacity-0 transition-[width,opacity,margin] duration-200 pointer-fine:block",
          "group-focus-within/volume:mx-1 group-focus-within/volume:w-20 group-focus-within/volume:opacity-100",
          "group-hover/volume:pointer-events-auto group-hover/volume:mx-1 group-hover/volume:w-20 group-hover/volume:opacity-100",
        )}
        onInput={(e) => setVolume(Number(e.currentTarget.value))}
        // A mouse drag leaves focus here, which would swallow the room's keyboard shortcuts.
        onPointerUp={(e) => e.currentTarget.blur()}
      />
    </div>
  );
}

/** Local only: fills the screen with the player. Hidden where the browser can't (iPhone). */
export function FullscreenToggle() {
  if (!canFullscreen) return null;
  const on = fullscreen.value;
  const label = on ? "Exit full screen" : "Full screen";
  return (
    <Button variant="ghost" icon aria-label={label} title={`${label} (f)`} onClick={toggleFullscreen}>
      {on ? <Minimize class="size-5" /> : <Maximize class="size-5" />}
    </Button>
  );
}

/** Local only: switches this browser between the side-by-side and full-width layouts. */
export function TheaterToggle() {
  const on = theater.value;
  const label = on ? "Default view" : "Theater mode";
  return (
    <Button
      variant="ghost"
      icon
      aria-label="Theater mode"
      aria-pressed={on}
      title={`${label} (t)`}
      onClick={toggleTheater}
    >
      {on ? <Columns2 class="size-5" /> : <RectangleHorizontal class="size-5" />}
    </Button>
  );
}
