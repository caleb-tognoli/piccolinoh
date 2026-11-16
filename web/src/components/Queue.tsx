import { GripVertical, ListMusic, X } from "lucide-preact";
import { useState } from "preact/hooks";
import { formatSec } from "../lib/format";
import { shiftFor, useListDrag } from "../lib/listDrag";
import type { Track } from "../protocol";
import { canEdit } from "../playlists";
import { connected, hideToast, sendControl, session, showToast } from "../store";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Panel } from "../ui/Panel";
import { ROW_ACTIONS } from "../ui/rowActions";
import { AddBox } from "./AddBox";
import { AddToPlaylist } from "./AddToPlaylist";
import { Thumbnail } from "./Thumbnail";

const UNDO_TOAST_MS = 6000;
/** Rows rendered before "Show all": a whole imported playlist would make every update slow. */
export const QUEUE_WINDOW = 200;

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
  const current = session.value?.current;
  const totalSec = queue.reduce((sum, t) => sum + t.durationSec, 0);
  const { listRef, drag, shown, handleProps } = useListDrag(queue, (from, to) => sendControl({ kind: "reorder", from, to }));
  const canReorder = connected.value && shown.length > 1;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? shown : shown.slice(0, QUEUE_WINDOW);
  const hidden = shown.length - visible.length;

  return (
    <Panel
      title="Queue"
      count={queue.length}
      meta={
        queue.length > 0 ? (
          <span class="flex items-center gap-1">
            {formatSec(totalSec)} total
            <AddToPlaylist
              videoIds={[...(current ? [current.videoId] : []), ...queue.map((t) => t.videoId)]}
              label="Save what's playing and the queue to a playlist"
              class="-my-1.5"
            />
          </span>
        ) : undefined
      }
    >
      <AddBox target={{ kind: "queue" }} />
      {queue.length === 0 ? (
        <p class="text-sm text-muted">
          Nothing queued.{" "}
          {canEdit.value ? (
            "Search above, or queue a playlist."
          ) : (
            <>
              Add videos with <code class="rounded bg-raised px-1.5 py-0.5 text-ink">/play</code> in Discord.
            </>
          )}
        </p>
      ) : (
        <ol
          ref={listRef}
          class={cn(
            "scroll-thin relative -mx-2 flex max-h-[min(28rem,60dvh)] flex-col gap-0.5 overflow-y-auto overscroll-contain lg:max-h-[32rem]",
            drag && "select-none",
          )}
        >
          {visible.map((track, index) => {
            const dragging = drag?.from === index;
            const offset = drag ? (dragging ? drag.offsetY : shiftFor(drag, index)) : 0;
            return (
              <li
                key={`${index}-${track.videoId}`}
                class={cn(
                  "group flex items-center gap-1 rounded-lg py-2 pr-2 pl-0.5",
                  dragging ? "relative z-10 bg-raised shadow-lg ring-1 shadow-black/40 ring-line" : "hover:bg-raised",
                  drag && !dragging && "transition-transform duration-150",
                )}
                style={offset ? { transform: `translateY(${offset}px)` } : undefined}
              >
                <button
                  type="button"
                  data-handle
                  aria-label={`Move ${track.title} (arrow keys)`}
                  title="Drag to reorder"
                  disabled={!canReorder}
                  class={cn(
                    "flex h-10 w-5 shrink-0 touch-none items-center justify-center rounded text-muted/60 hover:text-ink disabled:invisible",
                    dragging ? "cursor-grabbing text-ink" : "cursor-grab",
                  )}
                  {...handleProps(index)}
                >
                  <GripVertical class="size-4" />
                </button>
                <div class="relative shrink-0">
                  <Thumbnail videoId={track.videoId} class="pointer-events-none w-24" />
                  <span class="absolute right-1 bottom-1 rounded bg-black/75 px-1 text-[11px] leading-4 font-medium tabular-nums">
                    {formatSec(track.durationSec)}
                  </span>
                </div>
                <div class="ml-2 min-w-0 flex-1">
                  {index === 0 && (
                    <p class="text-[11px] font-semibold tracking-wider text-accent uppercase">Up next</p>
                  )}
                  <p class="line-clamp-2 text-sm leading-snug font-medium" title={track.title}>
                    {track.title}
                  </p>
                  <p class="flex gap-1 text-xs text-muted">
                    <span class="truncate">{track.author}</span>
                    {track.startSec ? <span class="shrink-0">· from {formatSec(track.startSec)}</span> : null}
                    {track.addedBy ? <span class="max-w-[45%] shrink-0 truncate">· {track.addedBy.name}</span> : null}
                  </p>
                  {track.fromPlaylist ? (
                    <p class="flex items-center gap-1 text-xs text-muted" title={`From the playlist “${track.fromPlaylist.name}”`}>
                      <ListMusic class="size-3 shrink-0" aria-hidden />
                      <span class="truncate">{track.fromPlaylist.name}</span>
                    </p>
                  ) : null}
                </div>
                <div class={ROW_ACTIONS}>
                  <AddToPlaylist videoIds={[track.videoId]} />
                  <Button
                    variant="ghost"
                    size="xs"
                    icon
                    aria-label={`Remove ${track.title}`}
                    title="Remove"
                    disabled={!connected.value || drag != null}
                    onClick={() => removeTrack(index, track.title, track.videoId)}
                  >
                    <X class="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {hidden > 0 && (
        <Button variant="ghost" size="sm" class="mt-2 w-full" onClick={() => setShowAll(true)}>
          Show all {shown.length.toLocaleString()} ({hidden.toLocaleString()} more)
        </Button>
      )}
    </Panel>
  );
}
