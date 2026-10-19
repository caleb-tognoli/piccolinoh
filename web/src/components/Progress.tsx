import { useEffect, useRef, useState } from "preact/hooks";
import { formatSec } from "../lib/format";
import { trackPosition } from "../net";
import type { CurrentTrack } from "../protocol";
import { connected, sendControl, session } from "../store";
import { cn } from "../ui/cn";

const TICK_MS = 250;
const KEY_STEP_SEC = 5;
const PENDING_TIMEOUT_MS = 2000;

/** Shared timeline: click or drag to seek the room, arrow keys step 5 s. */
export function Progress({ track }: { track: CurrentTrack }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const [dragSec, setDragSec] = useState<number | null>(null);
  const [hoverSec, setHoverSec] = useState<number | null>(null);
  // A seek we sent, shown until the server's new state arrives so the bar doesn't snap back.
  const [pendingSec, setPendingSec] = useState<number | null>(null);
  const epoch = session.value?.epoch;
  const paused = track.pausedAtPositionSec != null;
  const enabled = connected.value;
  const duration = track.durationSec;

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  useEffect(() => setPendingSec(null), [epoch]);
  useEffect(() => {
    if (pendingSec == null) return;
    const id = window.setTimeout(() => setPendingSec(null), PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [pendingSec]);

  const clamp = (sec: number): number => Math.max(0, Math.min(duration, sec));
  const position = clamp(dragSec ?? pendingSec ?? trackPosition(track));
  const pct = duration > 0 ? (position / duration) * 100 : 0;

  const secAt = (clientX: number): number => {
    const rect = barRef.current!.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * duration);
  };
  const seek = (sec: number): void => {
    setPendingSec(sec);
    sendControl({ kind: "seek", toSec: sec });
  };

  return (
    <div class={cn("flex flex-col gap-1", !enabled && "opacity-50")}>
      <div
        ref={barRef}
        role="slider"
        tabIndex={enabled ? 0 : -1}
        aria-label="Seek"
        aria-disabled={!enabled}
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(position)}
        aria-valuetext={`${formatSec(position)} of ${formatSec(duration)}`}
        class={cn(
          "group relative flex h-6 touch-none items-center select-none focus-visible:outline-none",
          enabled ? "cursor-pointer" : "cursor-not-allowed",
        )}
        onPointerDown={(e) => {
          if (!enabled || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragSec(secAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!enabled) return;
          const sec = secAt(e.clientX);
          setHoverSec(sec);
          if (dragSec != null) setDragSec(sec);
        }}
        onPointerUp={() => {
          if (dragSec == null) return;
          seek(dragSec);
          setDragSec(null);
        }}
        onPointerCancel={() => setDragSec(null)}
        onPointerLeave={() => setHoverSec(null)}
        onKeyDown={(e) => {
          if (!enabled) return;
          const step = { ArrowLeft: -KEY_STEP_SEC, ArrowDown: -KEY_STEP_SEC, ArrowRight: KEY_STEP_SEC, ArrowUp: KEY_STEP_SEC }[e.key];
          if (step != null) seek(clamp(position + step));
          else if (e.key === "Home") seek(0);
          else return;
          e.preventDefault();
        }}
      >
        <div class="relative h-1 w-full overflow-hidden rounded-full bg-raised transition-[height] group-hover:h-1.5">
          {hoverSec != null && dragSec == null && (
            <div class="absolute inset-y-0 left-0 bg-ink/15" style={{ width: `${(hoverSec / duration) * 100}%` }} />
          )}
          <div class="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <div
          class={cn(
            "absolute size-3.5 -translate-x-1/2 rounded-full bg-ink shadow-md shadow-black/40 transition-opacity group-focus-visible:ring-4 group-focus-visible:ring-accent/50",
            dragSec != null ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
          style={{ left: `${pct}%` }}
        />
        {(dragSec ?? hoverSec) != null && (
          <div
            class="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md bg-raised px-1.5 py-0.5 text-xs tabular-nums shadow-lg shadow-black/40 ring-1 ring-line"
            style={{ left: `${((dragSec ?? hoverSec)! / duration) * 100}%` }}
          >
            {formatSec((dragSec ?? hoverSec)!)}
          </div>
        )}
      </div>
      <div class="flex justify-between text-xs text-muted tabular-nums">
        <span>{formatSec(position)}</span>
        <span>{formatSec(duration)}</span>
      </div>
    </div>
  );
}
