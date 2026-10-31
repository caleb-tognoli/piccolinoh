import { ListEnd, Pause, Play, SkipForward, SquareStop } from "lucide-preact";
import { connected, sendControl, session } from "../store";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Progress } from "./Progress";

export function Controls() {
  const current = session.value?.current;
  if (!current) return null;

  const paused = current.pausedAtPositionSec != null;
  return (
    <div class="flex flex-col gap-3">
      <Progress track={current} />
      <fieldset disabled={!connected.value} class="flex min-w-0 items-center gap-2">
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
        <AutoplayStatus />
      </fieldset>
    </div>
  );
}

/** Read-only: autoplay is switched with /autoplay in Discord. */
function AutoplayStatus() {
  const on = session.value?.autoplay ?? true;
  return (
    <span
      class={cn(
        "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        on ? "bg-raised text-muted" : "bg-warning/15 text-warning",
      )}
      title="Change with /autoplay in Discord"
    >
      {on ? <ListEnd class="size-3.5" /> : <SquareStop class="size-3.5" />}
      {on ? "Autoplay on" : "Autoplay off · stops after this video"}
    </span>
  );
}
