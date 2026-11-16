import { Check, ChevronDown, Plus, Shuffle, SkipForward } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { connected } from "../store";
import { cn } from "../ui/cn";

export type QueueHow = { next: boolean; shuffle: boolean };

/** What the arrow offers besides the main action: playing next, and (for many tracks) shuffled. */
type Extra = "next" | "shuffled";

const MENU_WIDTH_PX = 160;

const looks = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "bg-raised text-ink border border-line hover:border-muted/60",
} as const;

const sizes = {
  xs: { main: "h-7 pl-2 pr-2.5 text-xs gap-1", arrow: "h-7 w-6", icon: "size-3.5" },
  sm: { main: "h-8 pl-2.5 pr-3 text-sm gap-1.5", arrow: "h-8 w-7", icon: "size-4" },
} as const;

/**
 * The add button used wherever something can be added: "+ Queue" with an
 * arrow for Next and Shuffled, or a plain "+ Add" when there's nothing else to
 * pick. `done` swaps the plus for a tick.
 */
export function QueueButton({
  label = "Queue",
  extras = ["next"],
  onAdd,
  look = "secondary",
  size = "xs",
  done = false,
  disabled = false,
  title,
  class: className,
}: {
  label?: ComponentChildren;
  extras?: Extra[];
  onAdd: (how: QueueHow) => void;
  look?: keyof typeof looks;
  size?: keyof typeof sizes;
  done?: boolean;
  disabled?: boolean;
  /** Says what gets added, for screen readers and the tooltip. */
  title?: string;
  class?: string;
}) {
  const [open, setOpen] = useState(false);
  const arrow = useRef<HTMLButtonElement>(null);
  const off = disabled || !connected.value;
  const s = sizes[size];
  const base =
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50";
  const split = extras.length > 0;

  return (
    <div class={cn("inline-flex shrink-0", className)}>
      <button
        type="button"
        class={cn(base, looks[look], s.main, split ? "rounded-l-lg" : "rounded-lg")}
        disabled={off}
        title={title}
        aria-label={title}
        onClick={() => onAdd({ next: false, shuffle: false })}
      >
        {done ? <Check class={s.icon} /> : <Plus class={s.icon} />}
        {label}
      </button>
      {split && (
        <button
          ref={arrow}
          type="button"
          class={cn(
            base,
            looks[look],
            s.arrow,
            "rounded-r-lg",
            look === "primary" ? "border-l border-accent-ink/25" : "-ml-px",
          )}
          disabled={off}
          aria-label="More ways to add"
          title="More ways to add"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown class={s.icon} />
        </button>
      )}
      {open && arrow.current && (
        <Menu
          anchor={arrow.current}
          extras={extras}
          onClose={() => setOpen(false)}
          onPick={(how) => {
            setOpen(false);
            onAdd(how);
          }}
        />
      )}
    </div>
  );
}

function Menu({
  anchor,
  extras,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  extras: Extra[];
  onClose: () => void;
  onPick: (how: QueueHow) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });

  // Under the arrow, right edges lined up; above it when there's no room below.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - MENU_WIDTH_PX - 8, r.right - MENU_WIDTH_PX));
    const below = window.innerHeight - r.bottom;
    setPos(below < 120 && r.top > below ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [anchor]);

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

  const item = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-surface focus-visible:bg-surface";
  return createPortal(
    <div
      ref={menu}
      role="menu"
      class="fixed z-30 rounded-lg border border-line bg-raised p-1 text-sm text-ink shadow-xl shadow-black/50"
      style={{
        width: `${MENU_WIDTH_PX}px`,
        left: `${pos.left}px`,
        top: pos.top != null ? `${pos.top}px` : undefined,
        bottom: pos.bottom != null ? `${pos.bottom}px` : undefined,
      }}
    >
      {extras.includes("next") && (
        <button type="button" role="menuitem" class={item} onClick={() => onPick({ next: true, shuffle: false })}>
          <SkipForward class="size-4 text-muted" /> Next
        </button>
      )}
      {extras.includes("shuffled") && (
        <button type="button" role="menuitem" class={item} onClick={() => onPick({ next: false, shuffle: true })}>
          <Shuffle class="size-4 text-muted" /> Shuffled
        </button>
      )}
    </div>,
    document.body,
  );
}
