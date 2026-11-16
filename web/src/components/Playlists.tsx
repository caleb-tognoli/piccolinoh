import { ArrowLeft, GripVertical, ListMusic, Plus, Trash, X } from "lucide-preact";
import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatSec } from "../lib/format";
import { shiftFor, useListDrag } from "../lib/listDrag";
import { act, canEdit, open, openId, openPlaylist, playlists } from "../playlists";
import type { PlaylistDetail, PlaylistSummary } from "../protocol";
import { connected, hideToast, showToast } from "../store";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { ROW_ACTIONS } from "../ui/rowActions";
import { AddBox } from "./AddBox";
import { createPlaylist, noteRecentPlaylist } from "./AddToPlaylist";
import { QueueButton } from "./QueueButton";
import { Thumbnail } from "./Thumbnail";

const UNDO_TOAST_MS = 6000;
/** Rows rendered before "Show all", like the queue. */
const WINDOW = 200;

const tracksLabel = (n: number) => `${n.toLocaleString()} track${n === 1 ? "" : "s"}`;

/** The guild's playlists, under the room: the list, or one playlist opened in place. */
export function Playlists() {
  return (
    <section class="rounded-xl border border-line bg-surface p-4">
      {openId.value !== null ? <Detail /> : <List />}
    </section>
  );
}

function Heading({ children }: { children: ComponentChildren }) {
  return <h2 class="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">{children}</h2>;
}

function Count({ n }: { n: number }) {
  return (
    <span class="rounded-full bg-raised px-2 py-0.5 text-[11px] tracking-normal text-ink/80 tabular-nums">{n}</span>
  );
}

/** A one-line name form, for new playlists and renames. */
function NameForm({
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const done = await onSubmit(name.trim());
        setBusy(false);
        if (done) onCancel();
      }}
    >
      <input
        value={name}
        maxLength={50}
        placeholder="Playlist name"
        aria-label="Playlist name"
        class="h-8 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-sm outline-none focus:border-accent/60"
        onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        autoFocus
      />
      <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim() || !connected.value}>
        {submitLabel}
      </Button>
      <Button variant="ghost" size="sm" icon aria-label="Cancel" onClick={onCancel}>
        <X class="size-4" />
      </Button>
    </form>
  );
}

function List() {
  const list = playlists.value;
  const [creating, setCreating] = useState(false);
  const editable = canEdit.value;

  return (
    <>
      <div class="flex min-h-8 items-center gap-2">
        {creating ? (
          <NameForm
            submitLabel="Create"
            onCancel={() => setCreating(false)}
            onSubmit={async (name) => {
              const id = await createPlaylist(name);
              if (id === undefined) return false;
              noteRecentPlaylist(id);
              void open(id);
              return true;
            }}
          />
        ) : (
          <>
            <Heading>
              Playlists
              <Count n={list.length} />
            </Heading>
            {editable && (
              <Button variant="ghost" size="xs" class="ml-auto" disabled={!connected.value} onClick={() => setCreating(true)}>
                <Plus class="size-4" /> New
              </Button>
            )}
          </>
        )}
      </div>
      {list.length === 0 ? (
        <p class="mt-2 text-sm text-muted">
          No playlists yet.{" "}
          {editable ? (
            <>Make one with New, or save tracks from the queue.</>
          ) : (
            <>
              Make one with <code class="rounded bg-raised px-1.5 py-0.5 text-ink">/playlist</code> in Discord.
            </>
          )}
        </p>
      ) : (
        <ul class="scroll-thin -mx-2 mt-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {list.map((p) => (
            <ListRow key={p.id} playlist={p} editable={editable} />
          ))}
        </ul>
      )}
      {!editable && <GuestHint />}
    </>
  );
}

function GuestHint() {
  return (
    <p class="mt-3 text-xs text-muted">
      You're a guest: open your <code class="rounded bg-raised px-1 text-ink">/join</code> link from Discord to queue
      and edit playlists.
    </p>
  );
}

function ListRow({ playlist, editable }: { playlist: PlaylistSummary; editable: boolean }) {
  return (
    <li class="group flex items-center gap-1 rounded-lg pr-1 hover:bg-raised">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left"
        onClick={() => void open(playlist.id)}
      >
        <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-raised text-muted group-hover:bg-surface">
          <ListMusic class="size-4" />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium">{playlist.name}</span>
          <span class="block text-xs text-muted tabular-nums">
            {tracksLabel(playlist.trackCount)}
            {playlist.trackCount > 0 && ` · ${formatSec(playlist.durationSec)}`}
          </span>
        </span>
      </button>
      {editable && playlist.trackCount > 0 && (
        <div class={ROW_ACTIONS}>
          <QueueButton
            extras={["next", "shuffled"]}
            title={`Queue ${playlist.name}`}
            onAdd={(how) => void queueAll(playlist.id, playlist.name, how.next, how.shuffle)}
          />
        </div>
      )}
    </li>
  );
}

async function queueAll(playlistId: number, name: string, next: boolean, shuffle: boolean): Promise<void> {
  const done = await act({ kind: "queuePlaylist", playlistId, next, shuffle });
  if (done) showToast(`Queued “${name}”${next ? " to play next" : ""}${shuffle ? ", shuffled" : ""}`, { durationMs: 3000 });
}

function Detail() {
  const playlist = openPlaylist.value;
  const summary = playlists.value.find((p) => p.id === openId.value);
  const editable = canEdit.value;
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const name = playlist?.name ?? summary?.name ?? "";
  const tracks = playlist?.tracks ?? [];

  return (
    <>
      <div class="flex min-h-8 items-center gap-1">
        <Button variant="ghost" size="sm" icon aria-label="Back to playlists" title="Back" onClick={() => void open(null)}>
          <ArrowLeft class="size-4" />
        </Button>
        {editable && playlist ? (
          <PlaylistName key={playlist.id} playlistId={playlist.id} name={playlist.name} />
        ) : (
          <h2 class="min-w-0 flex-1 truncate pl-1.5 font-semibold" title={name}>
            {name}
          </h2>
        )}
        {editable && playlist && (
          <>
            {tracks.length > 0 && (
              <QueueButton
                look="primary"
                size="sm"
                extras={["next", "shuffled"]}
                title={`Queue ${name}`}
                onAdd={(how) => void queueAll(playlist.id, name, how.next, how.shuffle)}
              />
            )}
            <button
              type="button"
              aria-label={`Delete ${name}`}
              title="Delete playlist"
              class="ml-1.5 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-danger/50 text-danger transition-colors hover:border-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!connected.value}
              onClick={() => deleteDialog.current?.showModal()}
            >
              <Trash class="size-4" />
            </button>
          </>
        )}
      </div>

      {editable && playlist && (
        <div class="mt-3">
          <AddBox key={playlist.id} target={{ kind: "playlist", playlistId: playlist.id }} />
        </div>
      )}
      {playlist ? <Tracks playlist={playlist} editable={editable} /> : <p class="mt-3 text-sm text-muted">Loading…</p>}
      {tracks.length > 0 && (
        <p class="mt-2 text-xs text-muted tabular-nums">
          {tracksLabel(tracks.length)} · {formatSec(tracks.reduce((sum, t) => sum + t.durationSec, 0))}
        </p>
      )}
      {!editable && <GuestHint />}
      {playlist && <DeleteDialog dialogRef={deleteDialog} playlist={playlist} />}
    </>
  );
}

/** The open playlist's name; click it to rename in place (Enter or clicking away saves, Escape cancels). */
function PlaylistName({ playlistId, name }: { playlistId: number; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useLayoutEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <h2 class="flex min-w-0 flex-1">
        <button
          type="button"
          class="max-w-full cursor-text truncate rounded-md px-1.5 py-0.5 text-left font-semibold hover:bg-raised disabled:cursor-default"
          title="Click to rename"
          disabled={!connected.value}
          onClick={() => {
            cancelled.current = false;
            setValue(name);
            setEditing(true);
          }}
        >
          {name}
        </button>
      </h2>
    );
  }

  const save = async () => {
    const next = value.trim();
    if (cancelled.current || !next || next === name) {
      setEditing(false);
      return;
    }
    // A taken name is toasted and the old one stays.
    await act({ kind: "renamePlaylist", playlistId, name: next });
    setEditing(false);
  };

  return (
    <input
      ref={input}
      value={value}
      maxLength={50}
      aria-label="Playlist name"
      class="h-8 min-w-0 flex-1 rounded-md border border-accent/60 bg-raised px-1.5 font-semibold outline-none"
      onInput={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => void save()}
    />
  );
}

function DeleteDialog({ dialogRef, playlist }: { dialogRef: RefObject<HTMLDialogElement>; playlist: PlaylistDetail }) {
  const [busy, setBusy] = useState(false);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-playlist-title"
      class="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-5 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <h2 id="delete-playlist-title" class="font-semibold">
        Delete “{playlist.name}”?
      </h2>
      <p class="mt-2 text-sm text-muted">
        Its {tracksLabel(playlist.tracks.length)} go for good, for everyone in the server. Discord shows who deleted it.
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button
          size="sm"
          class="border-danger/60 bg-danger/15 text-danger hover:border-danger"
          disabled={busy || !connected.value}
          onClick={async () => {
            setBusy(true);
            const done = await act({ kind: "deletePlaylist", playlistId: playlist.id });
            setBusy(false);
            dialogRef.current?.close();
            if (done) {
              showToast(`Deleted “${playlist.name}”`, { durationMs: 3000 });
              void open(null);
            }
          }}
        >
          <Trash class="size-4" /> Delete
        </Button>
      </div>
    </dialog>
  );
}

function removeTrack(playlistId: number, index: number, videoId: string, title: string): void {
  void act({ kind: "removePlaylistTrack", playlistId, index, videoId }).then((done) => {
    if (!done) return;
    const text = `Removed “${title}”`;
    showToast(text, {
      durationMs: UNDO_TOAST_MS,
      action: {
        label: "Undo",
        run: () => {
          void act({ kind: "restorePlaylistTrack", playlistId, videoId });
          hideToast(text);
        },
      },
    });
  });
}

function Tracks({ playlist, editable }: { playlist: PlaylistDetail; editable: boolean }) {
  const { tracks } = playlist;
  const { listRef, drag, shown, handleProps } = useListDrag(tracks, (from, to) => {
    void act({ kind: "movePlaylistTrack", playlistId: playlist.id, from, to, videoId: tracks[from]!.videoId });
  });
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? shown : shown.slice(0, WINDOW);
  const hidden = shown.length - visible.length;
  const canReorder = editable && connected.value && shown.length > 1;

  if (tracks.length === 0) {
    return <p class="mt-1 text-sm text-muted">Empty for now.{editable ? " Search above, or save tracks from the queue." : ""}</p>;
  }
  return (
    <>
      <ol
        ref={listRef}
        class={cn(
          "scroll-thin relative -mx-2 mt-3 flex max-h-[min(28rem,60dvh)] flex-col gap-0.5 overflow-y-auto overscroll-contain",
          drag && "select-none",
        )}
      >
        {visible.map((track, index) => {
          const dragging = drag?.from === index;
          const offset = drag ? (dragging ? drag.offsetY : shiftFor(drag, index)) : 0;
          return (
            <li
              key={track.videoId}
              class={cn(
                "group flex items-center gap-1 rounded-lg py-1.5 pr-1 pl-0.5",
                dragging ? "relative z-10 bg-raised shadow-lg ring-1 shadow-black/40 ring-line" : "hover:bg-raised",
                drag && !dragging && "transition-transform duration-150",
              )}
              style={offset ? { transform: `translateY(${offset}px)` } : undefined}
            >
              {/* The number turns into the drag handle while the row is hovered (always a handle on touch screens). */}
              {editable ? (
                <button
                  type="button"
                  data-handle
                  aria-label={`Move ${track.title} (arrow keys)`}
                  title={canReorder ? "Drag to reorder" : undefined}
                  disabled={!canReorder}
                  class={cn(
                    "group/handle relative flex h-10 w-7 shrink-0 touch-none items-center justify-center rounded text-xs text-muted tabular-nums",
                    canReorder && (dragging ? "cursor-grabbing" : "cursor-grab"),
                  )}
                  {...handleProps(index)}
                >
                  <span
                    class={cn(
                      canReorder &&
                        "group-hover:invisible group-focus-visible/handle:invisible pointer-coarse:invisible",
                      dragging && "invisible",
                    )}
                  >
                    {index + 1}
                  </span>
                  {canReorder && (
                    <GripVertical
                      class={cn(
                        "absolute size-4 text-muted group-hover:visible group-focus-visible/handle:visible pointer-coarse:visible hover:text-ink",
                        dragging ? "visible text-ink" : "invisible",
                      )}
                    />
                  )}
                </button>
              ) : (
                <span class="flex w-7 shrink-0 justify-center text-xs text-muted tabular-nums">{index + 1}</span>
              )}
              <Thumbnail videoId={track.videoId} class="pointer-events-none ml-1.5 w-20" />
              <div class="ml-2 min-w-0 flex-1">
                <p class="truncate text-sm font-medium" title={track.title}>
                  {track.title}
                </p>
                <p class="truncate text-xs text-muted">
                  {track.author} · <span class="tabular-nums">{formatSec(track.durationSec)}</span>
                </p>
              </div>
              {editable && (
                <div class={cn(ROW_ACTIONS, "gap-0.5")}>
                  <QueueButton
                    title={`Queue ${track.title}`}
                    disabled={drag != null}
                    onAdd={({ next }) =>
                      void act({ kind: "queuePlaylistTrack", playlistId: playlist.id, index, videoId: track.videoId, next }).then(
                        (done) =>
                          done && showToast(next ? `“${track.title}” plays next` : `Queued “${track.title}”`, { durationMs: 2500 }),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    icon
                    aria-label={`Remove ${track.title} from the playlist`}
                    title="Remove"
                    disabled={!connected.value || drag != null}
                    onClick={() => removeTrack(playlist.id, index, track.videoId, track.title)}
                  >
                    <X class="size-4" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {hidden > 0 && (
        <Button variant="ghost" size="sm" class="mt-2 w-full" onClick={() => setShowAll(true)}>
          Show all {shown.length.toLocaleString()} ({hidden.toLocaleString()} more)
        </Button>
      )}
    </>
  );
}
