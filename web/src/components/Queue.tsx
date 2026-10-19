import { X } from "lucide-preact";
import { formatSec } from "../lib/format";
import { connected, sendControl, session } from "../store";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";

export function Queue() {
  const queue = session.value?.queue ?? [];
  return (
    <Panel title="Queue" count={queue.length}>
      {queue.length === 0 ? (
        <p class="text-sm text-muted">Empty</p>
      ) : (
        <ol class="-mx-2 flex flex-col">
          {queue.map((track, index) => (
            <li
              key={`${index}-${track.videoId}`}
              class="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raised"
            >
              <span class="w-4 shrink-0 text-right text-xs text-muted tabular-nums">{index + 1}</span>
              <span class="min-w-0 flex-1 truncate text-sm" title={`${track.title} — ${track.author}`}>
                {track.title}
              </span>
              <span class="shrink-0 text-xs text-muted tabular-nums">{formatSec(track.durationSec)}</span>
              <Button
                variant="ghost"
                size="xs"
                icon
                aria-label={`Remove ${track.title}`}
                title="Remove"
                disabled={!connected.value}
                onClick={() => sendControl({ kind: "remove", index })}
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
