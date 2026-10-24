import { ChevronDown } from "lucide-preact";
import { useState } from "preact/hooks";
import { formatSec } from "../lib/format";
import { session } from "../store";
import { cn } from "../ui/cn";

const MAX_SHOWN = 50;

/** Secondary to the queue: a collapsed, borderless list of what already played. */
export function History() {
  const [open, setOpen] = useState(false);
  const played = (session.value?.history ?? []).slice(-MAX_SHOWN).reverse();
  if (played.length === 0) return null;

  return (
    <section class="px-4">
      <h2>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 py-1 text-xs font-semibold tracking-wider text-muted/80 uppercase hover:text-muted"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Recently played
          <span class="tracking-normal tabular-nums">· {played.length}</span>
          <ChevronDown class={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
        </button>
      </h2>
      {open && (
        <ol class="mt-1 flex flex-col">
          {played.map((track, i) => (
            <li key={`${i}-${track.videoId}`} class="flex items-baseline gap-3 py-1 text-xs text-muted">
              <span class="min-w-0 flex-1 truncate" title={`${track.title} — ${track.author}`}>
                {track.title}
              </span>
              <span class="shrink-0 tabular-nums">{formatSec(track.durationSec)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
