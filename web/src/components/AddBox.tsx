import { ListMusic, LoaderCircle, Search, X } from "lucide-preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { formatSec } from "../lib/format";
import { act, canEdit, request } from "../playlists";
import type { Track } from "../protocol";
import { connected, showToast } from "../store";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { AddToPlaylist, noteRecentPlaylist, saveToPlaylist } from "./AddToPlaylist";
import { QueueButton } from "./QueueButton";
import { Thumbnail } from "./Thumbnail";

/** Typed searches wait for this pause and this many characters; Enter searches at once. */
const DEBOUNCE_MS = 600;
const MIN_CHARS = 3;

const isLink = (text: string) => /^(https?:\/\/|spotify:)/i.test(text.trim());

type Results =
  | { kind: "videos"; tracks: Track[] }
  | { kind: "collection"; label: string; query: string };

type Target = { kind: "queue" } | { kind: "playlist"; playlistId: number };

/**
 * A search or link box. In the queue it queues (or plays next); in a playlist
 * it adds there. Searches run as you type (debounced, one at a time); links
 * resolve right away, except playlists and albums, which wait for Add.
 * Results show in a popover under the box, over whatever is below it.
 */
export function AddBox({ target }: { target: Target }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<{ query: string; results: Results } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  /** Whether the results popover is showing (it closes on outside clicks and Escape). */
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const inFlight = useRef<string | null>(null);
  const wanted = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const popoverId = useId();

  // Runs the latest wanted query, one request at a time; answers to older queries are dropped.
  const run = async () => {
    const query = wanted.current;
    if (!query || inFlight.current) return;
    inFlight.current = query;
    setBusy(true);
    const reply = await request<Results>({ kind: "lookup", query });
    inFlight.current = null;
    if (wanted.current === query) {
      setBusy(false);
      if (reply.ok && reply.data) {
        setResults({ query, results: reply.data });
        setError(null);
        setAdded(new Set());
      } else if (!reply.ok) {
        setError(reply.error);
      }
      setOpen(true);
    } else {
      void run();
    }
  };

  const lookup = (query: string, now: boolean) => {
    window.clearTimeout(timer.current);
    const q = query.trim();
    if (!q || (!now && !isLink(q) && q.length < MIN_CHARS)) {
      wanted.current = null;
      return;
    }
    if (results?.query === q) return;
    wanted.current = q;
    if (now || isLink(q)) void run();
    else timer.current = window.setTimeout(() => void run(), DEBOUNCE_MS);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Clicks outside the box close the popover; a "save to playlist" menu opened from a result doesn't count.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!box.current?.contains(t) && !t.closest?.("[role=menu]")) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const clear = () => {
    window.clearTimeout(timer.current);
    wanted.current = null;
    setText("");
    setResults(null);
    setError(null);
    setBusy(false);
    setOpen(false);
  };

  const addVideo = async (track: Track, next: boolean) => {
    if (target.kind === "playlist") {
      if (await saveToPlaylist(target.playlistId, [track.videoId])) setAdded((s) => new Set(s).add(track.videoId));
      return;
    }
    const done = await act({ kind: "enqueueVideo", videoId: track.videoId, next });
    if (!done) return;
    setAdded((s) => new Set(s).add(track.videoId));
    showToast(next ? `“${track.title}” plays next` : `Queued “${track.title}”`, { durationMs: 2500 });
  };

  const addCollection = async (query: string, label: string, next: boolean, shuffle = false) => {
    setBusy(true);
    const done = await act<{ added: number; name?: string; dropped?: string; duplicates?: number }>({
      kind: "addCollection",
      query,
      next,
      shuffle,
      playlistId: target.kind === "playlist" ? target.playlistId : null,
    });
    setBusy(false);
    if (!done?.data) return;
    const { added: count, name, dropped, duplicates } = done.data;
    if (target.kind === "playlist") noteRecentPlaylist(target.playlistId);
    const what = name ? `“${name}”` : label;
    const notes = [duplicates ? `${duplicates} already in it` : "", dropped ?? ""].filter(Boolean).join(" · ");
    const head =
      target.kind === "playlist"
        ? `Added ${count} track${count === 1 ? "" : "s"} from ${what}`
        : `Queued ${count} track${count === 1 ? "" : "s"} from ${what}${next ? " to play next" : ""}${shuffle ? ", shuffled" : ""}`;
    showToast(notes ? `${head} · ${notes}` : head, { durationMs: 4000 });
    clear();
  };

  if (!canEdit.value) return null;
  const shown = results?.results;
  const verb = target.kind === "playlist" ? "Add to playlist" : "Queue";
  const hasContent = Boolean(error || shown);
  const showing = open && hasContent;

  return (
    <div ref={box} class="group/box relative mb-3">
      <form
        class="relative"
        onSubmit={(e) => {
          e.preventDefault();
          const q = text.trim();
          // Enter adds the top result once it's showing; otherwise it searches now.
          if (results?.query === q && shown) {
            if (shown.kind === "videos" && shown.tracks[0]) void addVideo(shown.tracks[0], false);
            if (shown.kind === "collection") void addCollection(shown.query, shown.label, false);
          } else {
            lookup(q, true);
          }
        }}
      >
        <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={input}
          type="text"
          value={text}
          placeholder={target.kind === "playlist" ? "Add a song: search or paste a link" : "Search or paste a YouTube or Spotify link"}
          aria-label={target.kind === "playlist" ? "Add to this playlist" : "Add to the queue"}
          aria-expanded={showing}
          aria-controls={showing ? popoverId : undefined}
          disabled={!connected.value}
          class={cn(
            "h-9 w-full rounded-lg border border-line bg-raised pr-9 pl-9 text-sm outline-none placeholder:text-muted/70 group-focus-within/box:border-accent/60",
            showing && "rounded-b-none",
          )}
          onInput={(e) => {
            const value = e.currentTarget.value;
            setText(value);
            lookup(value, false);
            if (!value.trim()) clear();
          }}
          onFocus={() => hasContent && setOpen(true)}
          onClick={() => hasContent && setOpen(true)}
          onKeyDown={(e) => {
            // Escape closes the results first, then clears the box.
            if (e.key !== "Escape" || !text) return;
            e.stopPropagation();
            if (showing) setOpen(false);
            else clear();
          }}
        />
        <span class="absolute top-1/2 right-1 -translate-y-1/2">
          {busy ? (
            <LoaderCircle class="mr-2 size-4 animate-spin text-muted" aria-label="Searching" />
          ) : (
            text && (
              <Button variant="ghost" size="xs" icon aria-label="Clear" onClick={() => (clear(), input.current?.focus())}>
                <X class="size-4" />
              </Button>
            )
          )}
        </span>
      </form>
      {showing && (
        <div
          id={popoverId}
          class="scroll-thin absolute inset-x-0 top-full z-20 max-h-[min(26rem,60dvh)] overflow-y-auto overscroll-contain rounded-b-lg border border-t-0 border-line bg-raised p-1 shadow-xl shadow-black/50 group-focus-within/box:border-accent/60"
        >
          {error && <p class="px-2 py-1.5 text-xs text-danger">{error}</p>}

          {shown?.kind === "collection" && (
            <div class="flex items-center gap-3 rounded-md px-2 py-1.5">
              <ListMusic class="size-5 shrink-0 text-muted" />
              <p class="min-w-0 flex-1 truncate text-sm font-medium" title="Its videos are looked up when you add it">
                {shown.label}
              </p>
              <QueueButton
                label={target.kind === "playlist" ? "Add all" : "Queue all"}
                extras={target.kind === "playlist" ? [] : ["next", "shuffled"]}
                disabled={busy}
                onAdd={({ next, shuffle }) => void addCollection(shown.query, shown.label, next, shuffle)}
              />
            </div>
          )}

          {shown?.kind === "videos" &&
            (shown.tracks.length === 0 ? (
              <p class="px-2 py-1.5 text-sm text-muted">No results.</p>
            ) : (
              <ul class="flex flex-col gap-0.5" aria-label="Results">
                {shown.tracks.map((track) => {
                  const done = added.has(track.videoId);
                  return (
                    <li key={track.videoId} class="flex items-center gap-1 rounded-md pr-1 hover:bg-surface">
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md p-1 text-left"
                        title={`${verb}: ${track.title}`}
                        onClick={() => void addVideo(track, false)}
                      >
                        <Thumbnail videoId={track.videoId} class="w-16" />
                        <span class="min-w-0">
                          <span class="line-clamp-2 text-sm leading-snug">{track.title}</span>
                          <span class="block truncate text-xs text-muted">
                            {track.author} · <span class="tabular-nums">{formatSec(track.durationSec)}</span>
                          </span>
                        </span>
                      </button>
                      <QueueButton
                        label={target.kind === "playlist" ? "Add" : "Queue"}
                        extras={target.kind === "playlist" ? [] : ["next"]}
                        done={done}
                        title={`${verb}: ${track.title}`}
                        onAdd={({ next }) => void addVideo(track, next)}
                      />
                      {target.kind === "queue" && <AddToPlaylist videoIds={[track.videoId]} />}
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      )}
    </div>
  );
}
