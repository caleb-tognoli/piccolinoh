import { ChevronDown } from "lucide-preact";
import { useState } from "preact/hooks";
import { formatSec } from "../lib/format";
import { session } from "../store";
import { cn } from "../ui/cn";
import { AddToPlaylist } from "./AddToPlaylist";

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
        <ol class="scroll-thin mt-1 flex max-h-60 flex-col overflow-y-auto overscroll-contain">
          {played.map((track, i) => (
            <li key={`${i}-${track.videoId}`} class="group flex items-center gap-3 py-0.5 text-xs text-muted">
              <span class="min-w-0 flex-1 truncate" title={`${track.title} — ${track.author}`}>
                {track.title}
              </span>
              <span class="shrink-0 tabular-nums">{formatSec(track.durationSec)}</span>
              <AddToPlaylist videoIds={[track.videoId]} class="-my-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
