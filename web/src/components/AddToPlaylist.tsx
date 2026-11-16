import { Check, ListPlus, LoaderCircle, Plus } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { act, canEdit, playlists, request } from "../playlists";
import { showToast } from "../store";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";

const RECENT_KEY = "piccolinoh:recentPlaylists";
const RECENT_KEEP = 10;
/** A filter box shows once there are more playlists than this. */
const FILTER_AFTER = 6;
const WIDTH_PX = 256;

function readRecent(): number[] {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}

/** Remembers that `id` was just used, so pickers list it first. */
export function noteRecentPlaylist(id: number): void {
  try {
    const ids = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_KEEP);
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked; the order just isn't remembered
  }
}

/** Saves videos to a playlist and says how it went. */
export async function saveToPlaylist(playlistId: number, videoIds: string[]): Promise<boolean> {
  const done = await act<{ added: number; duplicates: number; overflow: number; name: string }>({
    kind: "addToPlaylist",
    playlistId,
    videoIds,
  });
  if (!done?.data) return false;
  noteRecentPlaylist(playlistId);
  const { added, duplicates, overflow, name } = done.data;
  const notes = [duplicates > 0 ? `${duplicates} already in it` : "", overflow > 0 ? `${overflow} didn't fit` : ""]
    .filter(Boolean)
    .join(" · ");
  const head = added === 0 ? `Already in “${name}”` : `Saved ${added === 1 ? "" : `${added} tracks `}to “${name}”`;
  showToast(notes && added > 0 ? `${head} · ${notes}` : head, { durationMs: 3500 });
  return true;
}

/** Makes a playlist and returns its id, or undefined (the error is toasted). */
export async function createPlaylist(name: string): Promise<number | undefined> {
  const done = await act<{ playlistId: number }>({ kind: "createPlaylist", name });
  return done?.data?.playlistId;
}

/**
 * "+ playlist" for one or more videos: a menu of the guild's playlists (recent
 * first; ticks on those already holding a single video) and "New playlist…".
 * Hidden for guests.
 */
export function AddToPlaylist({
  videoIds,
  label = "Save to playlist",
  size = "xs",
  class: className,
}: {
  videoIds: string[];
  label?: string;
  size?: "xs" | "sm";
  class?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!canEdit.value || videoIds.length === 0) return null;
  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        size={size}
        icon
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        class={className}
        onClick={() => setOpen(!open)}
      >
        <ListPlus class="size-4" />
      </Button>
      {open && button.current && (
        <Picker anchor={button.current} videoIds={videoIds} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function Picker({ anchor, videoIds, onClose }: { anchor: HTMLElement; videoIds: string[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const [holding, setHolding] = useState<Set<number> | null>(null);
  const [filter, setFilter] = useState("");
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  // Below the button, or above it when there's no room; never off the side of the screen.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - WIDTH_PX - 8, r.right - WIDTH_PX));
    const below = window.innerHeight - r.bottom;
    setPos(below < 280 && r.top > below ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, [anchor]);

  // Ticks only make sense for one video.
  useEffect(() => {
    if (videoIds.length !== 1) return;
    void request<{ playlistIds: number[] }>({ kind: "playlistsWith", videoId: videoIds[0]! }).then((reply) => {
      if (reply.ok) setHolding(new Set(reply.data?.playlistIds ?? []));
    });
  }, [videoIds.join(",")]);

  // Outside clicks, Escape, scrolling and resizing close it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
      anchor.focus();
    };
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const recent = readRecent();
  const rank = (id: number) => {
    const i = recent.indexOf(id);
    return i === -1 ? RECENT_KEEP : i;
  };
  const typed = filter.trim().toLowerCase();
  const shown = playlists.value
    .filter((p) => p.name.toLowerCase().includes(typed))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));

  const pick = async (id: number) => {
    setBusy(true);
    const saved = await saveToPlaylist(id, videoIds);
    setBusy(false);
    if (saved) onClose();
  };

  const create = async (e: Event) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const id = await createPlaylist(name);
    if (id !== undefined) await saveToPlaylist(id, videoIds);
    setBusy(false);
    if (id !== undefined) onClose();
  };

  return createPortal(
    <div
      ref={menu}
      role="menu"
      class="fixed z-30 flex max-h-80 flex-col overflow-hidden rounded-lg border border-line bg-raised text-sm shadow-xl shadow-black/50"
      style={{ width: `${WIDTH_PX}px`, left: `${pos.left}px`, top: pos.top != null ? `${pos.top}px` : undefined, bottom: pos.bottom != null ? `${pos.bottom}px` : undefined }}
    >
      <p class="flex items-center gap-2 px-3 pt-2.5 pb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
        Save to playlist
        {busy && <LoaderCircle class="size-3.5 animate-spin" aria-label="Saving" />}
      </p>
      {playlists.value.length > FILTER_AFTER && (
        <input
          type="search"
          value={filter}
          placeholder="Filter playlists"
          aria-label="Filter playlists"
          class="mx-2 mb-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent/60"
          onInput={(e) => setFilter(e.currentTarget.value)}
          autoFocus
        />
      )}
      <ul class="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        {shown.map((p) => {
          const has = holding?.has(p.id) ?? false;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface disabled:cursor-wait"
                onClick={() => void pick(p.id)}
              >
                <span class="min-w-0 flex-1 truncate">{p.name}</span>
                <span class="shrink-0 text-xs text-muted tabular-nums">{p.trackCount}</span>
                <Check class={cn("size-4 shrink-0 text-accent", !has && "invisible")} aria-label={has ? "Already in it" : undefined} />
              </button>
            </li>
          );
        })}
        {shown.length === 0 && playlists.value.length > 0 && <li class="px-2 py-1.5 text-muted">No matches</li>}
      </ul>
      <div class="border-t border-line p-1">
        {naming ? (
          <form class="flex gap-1 p-1" onSubmit={(e) => void create(e)}>
            <input
              value={newName}
              maxLength={50}
              placeholder="Playlist name"
              aria-label="New playlist name"
              class="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1 text-sm outline-none focus:border-accent/60"
              onInput={(e) => setNewName(e.currentTarget.value)}
              autoFocus
            />
            <Button type="submit" variant="primary" size="xs" disabled={busy || !newName.trim()}>
              Create
            </Button>
          </form>
        ) : (
          <button
            type="button"
            role="menuitem"
            class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-accent hover:bg-surface"
            onClick={() => setNaming(true)}
          >
            <Plus class="size-4" /> New playlist…
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
