import { useEffect, useState } from "preact/hooks";
import { trackPosition } from "../net";
import { session } from "../store";
import { cn } from "../ui/cn";
import { Thumbnail } from "./Thumbnail";

/** How long before the end the card shows. */
const LEAD_SEC = 10;
/** Shorter videos would be half covered by it. */
const MIN_DURATION_SEC = 30;
const TICK_MS = 250;

/**
 * A "Up next" card in the player's corner for the last seconds of a video, so the room knows
 * what's coming. Only when the queue will really advance: autoplay on, something queued, playing.
 */
export function UpNext() {
  const s = session.value;
  const current = s?.current;
  const next = s?.queue[0];
  const eligible =
    !!s?.autoplay &&
    !!current &&
    !!next &&
    current.pausedAtPositionSec == null &&
    current.durationSec >= MIN_DURATION_SEC;

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!eligible) return;
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [eligible]);

  const remaining = eligible ? current.durationSec - trackPosition(current) : Infinity;
  const show = remaining > 0 && remaining <= LEAD_SEC;

  // Stays mounted while eligible so it can fade in and out.
  if (!eligible) return null;
  return (
    <div
      aria-hidden={!show}
      class={cn(
        "pointer-events-none absolute right-2 bottom-2 flex w-56 items-center gap-2.5 rounded-lg border border-line bg-bg/85 p-2 shadow-xl shadow-black/50 backdrop-blur-sm transition duration-300 sm:right-4 sm:bottom-4 sm:w-72 sm:gap-3",
        // --lift: the stage's fullscreen controls, which this sits above while they show.
        show ? "-translate-y-(--lift) opacity-100" : "translate-y-[calc(0.5rem-var(--lift))] opacity-0",
      )}
    >
      <Thumbnail videoId={next.videoId} class="w-16 sm:w-24" />
      <div class="min-w-0">
        <p class="text-[0.65rem] font-semibold tracking-wider text-accent uppercase sm:text-xs">Up next</p>
        <p class="line-clamp-2 text-xs leading-snug font-semibold sm:text-sm" title={next.title}>
          {next.title}
        </p>
        <p class="hidden truncate text-xs text-muted sm:block">{next.author}</p>
      </div>
    </div>
  );
}
