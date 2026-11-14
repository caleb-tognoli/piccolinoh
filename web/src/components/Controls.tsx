import {
  Columns2,
  ListEnd,
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
    <fieldset disabled={!connected.value} class={cn("flex items-center gap-2", className)}>
      <Button
        variant="primary"
        size="lg"
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

/** Read-only: autoplay is switched with /autoplay in Discord. */
export function AutoplayStatus() {
  const on = session.value?.autoplay ?? true;
  return (
    <span
      class={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        on ? "bg-raised text-muted" : "bg-warning/15 text-warning",
      )}
      title="Change with /autoplay in Discord"
    >
      {on ? <ListEnd class="size-3.5 shrink-0" /> : <SquareStop class="size-3.5 shrink-0" />}
      <span class="truncate">{on ? "Autoplay on" : "Autoplay off · stops after this video"}</span>
    </span>
  );
}

/** Local only: this browser's mute and volume. The slider is hidden on phones, where the hardware buttons set volume. */
export function VolumeControl() {
  const silent = muted.value || volume.value === 0;
  const level = silent ? 0 : volume.value;
  const Icon = silent ? VolumeX : level < 50 ? Volume1 : Volume2;
  return (
    <div class="flex items-center">
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
        class="hidden h-1 w-20 cursor-pointer accent-accent pointer-fine:block"
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
