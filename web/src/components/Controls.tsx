import { Columns2, ListEnd, Pause, Play, RectangleHorizontal, SkipForward, SquareStop } from "lucide-preact";
import { connected, sendControl, session, theater, toggleTheater } from "../store";
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
