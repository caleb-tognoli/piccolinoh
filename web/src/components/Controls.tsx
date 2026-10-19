import { Pause, Play, SkipForward } from "lucide-preact";
import { connected, sendControl, session } from "../store";
import { Button } from "../ui/Button";
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
      </fieldset>
    </div>
  );
}
