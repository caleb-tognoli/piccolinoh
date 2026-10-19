import { Pause, Play, SkipForward } from "lucide-preact";
import { useState } from "preact/hooks";
import { parseTime } from "../lib/format";
import { connected, sendControl, session } from "../store";
import { Button } from "../ui/Button";

export function Controls() {
  const current = session.value?.current;
  const [seekText, setSeekText] = useState("");
  if (!current) return null;

  const paused = current.pausedAtPositionSec != null;
  return (
    <fieldset disabled={!connected.value} class="flex min-w-0 flex-wrap items-center gap-2">
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
      <form
        class="ml-auto flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const toSec = parseTime(seekText);
          if (toSec == null) return;
          sendControl({ kind: "seek", toSec });
          setSeekText("");
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          aria-label="Seek to time"
          placeholder="mm:ss"
          value={seekText}
          onInput={(e) => setSeekText(e.currentTarget.value)}
          class="h-8 w-20 rounded-lg border border-line bg-bg px-2.5 text-sm tabular-nums placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <Button type="submit" size="sm">
          Seek
        </Button>
      </form>
    </fieldset>
  );
}
