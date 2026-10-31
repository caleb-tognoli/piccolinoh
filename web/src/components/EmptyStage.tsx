import { Play } from "lucide-preact";
import { connected, sendControl, session } from "../store";
import { Button } from "../ui/Button";

/** Covers the player when nothing is playing: how to start, or how to resume a stopped queue. */
export function EmptyStage() {
  const s = session.value;
  if (!s || s.current) return null;
  const next = s.queue[0];

  return (
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_center,var(--color-surface),var(--color-bg)_75%)] p-6 text-center">
      <img src="/piccolinoh-cutout.png" alt="" class="size-16 drop-shadow-xl sm:size-32" />
      {next ? (
        <>
          <div>
            <h1 class="font-semibold sm:text-lg">Stopped after the last video</h1>
            <p class="mt-1 text-xs text-muted sm:text-sm">
              Autoplay is off. Up next: <span class="text-ink">{next.title}</span>
            </p>
          </div>
          <Button variant="primary" disabled={!connected.value} onClick={() => sendControl({ kind: "skip" })}>
            <Play class="size-4" fill="currentColor" /> Play next
          </Button>
        </>
      ) : (
        <div>
          <h1 class="font-semibold sm:text-lg">Nothing playing yet</h1>
          <p class="mt-1 text-xs text-muted sm:text-sm">
            In Discord, type <code class="rounded bg-raised px-1.5 py-0.5 text-ink">/play</code> with a song name or a
            YouTube link. Everyone here will watch it in sync.
          </p>
        </div>
      )}
    </div>
  );
}
