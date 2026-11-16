// Pointer-driven reordering for a list, shared by the queue and playlists.
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** Matches the list's `gap-0.5`. */
const GAP_PX = 2;
/** Within this distance of the list's top or bottom edge, a drag scrolls the list. */
const EDGE_PX = 48;
const MAX_SCROLL_PX_PER_FRAME = 12;

function moved<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

interface Drag {
  from: number;
  to: number;
  pointerId: number;
  /** Pointer position at the start, in list-content coordinates (so scrolling moves the item too). */
  startY: number;
  /** How far the dragged item has moved from where it started. */
  offsetY: number;
  /** Each item's top and height in list-content coordinates, as laid out when the drag began. */
  slots: { top: number; height: number }[];
}

/** Where a dragged item lands: past every other item whose middle its own middle has crossed. */
function targetIndex(drag: Drag): number {
  const { from, slots, offsetY } = drag;
  const mid = slots[from]!.top + offsetY + slots[from]!.height / 2;
  let to = 0;
  slots.forEach((s, i) => {
    if (i !== from && mid > s.top + s.height / 2) to++;
  });
  return to;
}

/** How far item `i` slides aside to make room while another is dragged. */
export function shiftFor(drag: Drag, i: number): number {
  const { from, to, slots } = drag;
  const room = slots[from]!.height + GAP_PX;
  if (from < to && i > from && i <= to) return -room;
  if (to < from && i >= to && i < from) return room;
  return 0;
}

/**
 * Pointer-driven reordering (works with touch, unlike HTML drag and drop): grab an item's handle,
 * drag it, and the others slide aside. The list keeps the new order until the server's next state.
 */
export function useListDrag<T>(queue: T[], onMove: (from: number, to: number) => void) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastClientY = useRef(0);
  // Shown until the server's state replaces this exact queue, so the item doesn't snap back meanwhile.
  const [optimistic, setOptimistic] = useState<{ basedOn: T[]; order: T[] } | null>(null);

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /** Re-reads the pointer against the list (also after the list scrolled under it). */
  const track = (clientY: number) => {
    const d = dragRef.current;
    const list = listRef.current;
    if (!d || !list) return;
    lastClientY.current = clientY;
    const y = clientY - list.getBoundingClientRect().top + list.scrollTop;
    const first = d.slots[0]!.top;
    const last = d.slots[d.slots.length - 1]!;
    const own = d.slots[d.from]!;
    // Keep the item within the list's ends.
    const offsetY = Math.max(first - own.top, Math.min(last.top + last.height - own.height - own.top, y - d.startY));
    const next = { ...d, offsetY };
    next.to = targetIndex(next);
    update(next);
  };

  // While dragging near the list's top or bottom edge, scroll it.
  useEffect(() => {
    if (!drag) return;
    let frame = requestAnimationFrame(function step() {
      const list = listRef.current;
      if (list) {
        const { top, bottom } = list.getBoundingClientRect();
        const y = lastClientY.current;
        const speed =
          y < top + EDGE_PX
            ? -Math.min(1, (top + EDGE_PX - y) / EDGE_PX)
            : y > bottom - EDGE_PX
              ? Math.min(1, (y - bottom + EDGE_PX) / EDGE_PX)
              : 0;
        if (speed !== 0) {
          const before = list.scrollTop;
          list.scrollTop += speed * MAX_SCROLL_PX_PER_FRAME;
          if (list.scrollTop !== before) track(y);
        }
      }
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [drag != null]);

  const finish = (commit: boolean) => {
    const d = dragRef.current;
    update(null);
    if (!d || !commit || d.from === d.to) return;
    onMove(d.from, d.to);
    setOptimistic({ basedOn: queue, order: moved(queue, d.from, d.to) });
  };

  const handleProps = (index: number): JSX.HTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (e) => {
      const list = listRef.current;
      if (!list || e.button !== 0 || dragRef.current) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const slots = [...list.children].map((li) => {
        const el = li as HTMLElement;
        return { top: el.offsetTop, height: el.offsetHeight };
      });
      lastClientY.current = e.clientY;
      update({
        from: index,
        to: index,
        pointerId: e.pointerId,
        startY: e.clientY - list.getBoundingClientRect().top + list.scrollTop,
        offsetY: 0,
        slots,
      });
    },
    onPointerMove: (e) => {
      if (dragRef.current?.pointerId === e.pointerId) track(e.clientY);
    },
    onPointerUp: (e) => {
      if (dragRef.current?.pointerId === e.pointerId) finish(true);
    },
    onPointerCancel: (e) => {
      if (dragRef.current?.pointerId === e.pointerId) finish(false);
    },
    onLostPointerCapture: (e) => {
      if (dragRef.current?.pointerId === e.pointerId) finish(false);
    },
    // Keyboard: arrow keys move the focused item one place.
    onKeyDown: (e) => {
      const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : null;
      if (to == null) return;
      e.preventDefault();
      if (to < 0 || to >= queue.length) return;
      onMove(index, to);
      setOptimistic({ basedOn: queue, order: moved(queue, index, to) });
      // The item re-renders at its new place; keep the keyboard on it.
      requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-handle]")[to]?.focus());
    },
  });

  const shown = optimistic?.basedOn === queue ? optimistic.order : queue;
  return { listRef, drag, shown, handleProps };
}

