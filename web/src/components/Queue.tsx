import { X } from "lucide-preact";
import { formatSec } from "../lib/format";
import { connected, hideToast, sendControl, session, showToast } from "../store";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";
import { Thumbnail } from "./Thumbnail";

const UNDO_TOAST_MS = 6000;

function removeTrack(index: number, title: string, videoId: string): void {
  sendControl({ kind: "remove", index });
  const text = `Removed “${title}”`;
  showToast(text, {
    durationMs: UNDO_TOAST_MS,
    action: {
      label: "Undo",
      run: () => {
        sendControl({ kind: "restore", videoId });
        hideToast(text);
      },
    },
  });
}

export function Queue() {
  const queue = session.value?.queue ?? [];
  const totalSec = queue.reduce((sum, t) => sum + t.durationSec, 0);
  return (
    <Panel title="Queue" count={queue.length} meta={queue.length > 0 ? `${formatSec(totalSec)} total` : undefined}>
      {queue.length === 0 ? (
        <p class="text-sm text-muted">
          Nothing queued. Add videos with <code class="rounded bg-raised px-1.5 py-0.5 text-ink">/play</code> in Discord.
        </p>
      ) : (
        <ol class="-mx-2 flex flex-col gap-0.5">
          {queue.map((track, index) => (
            <li
              key={`${index}-${track.videoId}`}
              class="group flex items-center gap-3 rounded-lg p-2 hover:bg-raised"
            >
              <div class="relative shrink-0">
                <Thumbnail videoId={track.videoId} class="w-24" />
                <span class="absolute right-1 bottom-1 rounded bg-black/75 px-1 text-[11px] leading-4 font-medium tabular-nums">
                  {formatSec(track.durationSec)}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                {index === 0 && (
                  <p class="text-[11px] font-semibold tracking-wider text-accent uppercase">Up next</p>
                )}
                <p class="line-clamp-2 text-sm leading-snug font-medium" title={track.title}>
                  {track.title}
                </p>
                <p class="truncate text-xs text-muted">{track.author}</p>
              </div>
              <Button
                variant="ghost"
                size="xs"
                icon
                aria-label={`Remove ${track.title}`}
                title="Remove"
                disabled={!connected.value}
                class="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => removeTrack(index, track.title, track.videoId)}
              >
                <X class="size-4" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
