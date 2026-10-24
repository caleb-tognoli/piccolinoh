import { Keyboard, X } from "lucide-preact";
import type { RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";
import { formatSec } from "../lib/format";
import { trackPosition } from "../net";
import type { ControlAction } from "../protocol";
import { connected, sendControl, session, showToast } from "../store";
import { Button } from "../ui/Button";

const FEEDBACK_TOAST_MS = 1500;

const SHORTCUTS: [keys: string[], label: string][] = [
  [["Space", "K"], "Play / pause"],
  [["←", "→"], "Back / forward 5 s"],
  [["J", "L"], "Back / forward 10 s"],
  [["N"], "Skip to the next video"],
  [["?"], "Show these shortcuts"],
];

const SEEK_KEYS: Record<string, number> = { ArrowLeft: -5, ArrowRight: 5, j: -10, l: 10 };

/** Keys meant for what has focus: typing, a focused button/slider, or the open cheat sheet. */
function targetHandlesKey(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || el === document.body) return false;
  if (el.closest("dialog")) return true;
  if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return e.key === " " && (el.tagName === "BUTTON" || el.getAttribute("role") === "slider");
}

/** YouTube-style shortcuts for the shared player; `onHelp` opens the cheat sheet. */
export function useKeyboardShortcuts(onHelp: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || targetHandlesKey(e)) return;
      if (e.key === "?") {
        e.preventDefault();
        onHelp();
        return;
      }
      const current = session.value?.current;
      if (!current || !connected.value) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let action: ControlAction | null = null;
      if (key === " " || key === "k") {
        action = { kind: current.pausedAtPositionSec != null ? "play" : "pause" };
      } else if (key === "n") {
        action = { kind: "skip" };
        showToast("Skipped", { durationMs: FEEDBACK_TOAST_MS });
      } else if (key in SEEK_KEYS) {
        const toSec = Math.max(0, Math.min(current.durationSec, trackPosition(current) + SEEK_KEYS[key]!));
        action = { kind: "seek", toSec };
        showToast(`Jumped to ${formatSec(toSec)}`, { durationMs: FEEDBACK_TOAST_MS });
      }
      if (!action) return;
      e.preventDefault();
      sendControl(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onHelp]);
}

/** Header button + modal cheat sheet. Pass the ref so `?` can open it too. */
export function ShortcutsHelp({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement> }) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Keyboard class="size-4" />
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby="shortcuts-title"
        class="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-5 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
        onClick={(e) => {
          // A click on the backdrop lands on the <dialog> itself.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div class="mb-4 flex items-center">
          <h2 id="shortcuts-title" class="font-semibold">
            Keyboard shortcuts
          </h2>
          <form method="dialog" class="ml-auto">
            <Button type="submit" variant="ghost" size="xs" icon aria-label="Close">
              <X class="size-4" />
            </Button>
          </form>
        </div>
        <dl class="flex flex-col gap-2.5 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label} class="flex items-center gap-3">
              <dt class="flex w-24 shrink-0 gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    class="min-w-7 rounded-md border border-line border-b-2 bg-raised px-1.5 py-0.5 text-center font-sans text-xs"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd class="text-muted">{label}</dd>
            </div>
          ))}
        </dl>
        <p class="mt-4 text-xs text-muted">Controls are shared: everyone in the room sees the change.</p>
      </dialog>
    </>
  );
}

export function useShortcutsDialog(): [RefObject<HTMLDialogElement>, () => void] {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useCallback(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return [ref, open];
}
