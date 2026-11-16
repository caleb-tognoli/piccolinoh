import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { attachPlayer } from "../player";
import { fullscreen, session, STAGE_ID, toggleFullscreen, wsClient } from "../store";
import { cn } from "../ui/cn";
import { EmptyStage } from "./EmptyStage";
import { NowPlaying } from "./NowPlaying";
import { Toast } from "./Toast";
import { UpNext } from "./UpNext";

const PLAYER_ID = "yt-player";
/** How long the fullscreen controls stay up after the last mouse move, tap or key press. */
const IDLE_MS = 3000;
/** Space kept between the fullscreen controls and Up next / toasts lifted above them. */
const LIFT_GAP_PX = 8;

/**
 * Fullscreen only shows the stage, so the stage draws its own copy of the controls card over
 * the video. It shows on mouse move, a tap or a key press and hides after a few idle seconds
 * while playing; it stays up while paused, under the pointer, or holding keyboard focus.
 */
function useFullscreenControls() {
  const on = fullscreen.value;
  const [shown, setShown] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setShown(false);
  }, []);
  const wake = useCallback(() => {
    setShown(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const paused = session.value?.current?.pausedAtPositionSec != null;
      const focused = overlayRef.current?.querySelector(":focus-visible") != null;
      // Held up: the next activity (or resuming) starts the countdown again.
      if (!paused && !hovered.current && !focused) setShown(false);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    if (!on) return;
    wake();
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("keydown", wake);
      window.clearTimeout(hideTimer.current);
      hovered.current = false;
    };
  }, [on, wake]);

  // Pausing holds the controls up; resuming starts the idle countdown.
  const paused = session.value?.current?.pausedAtPositionSec != null;
  useEffect(() => {
    if (on) wake();
  }, [paused]);

  return { on, shown: on && shown, overlayRef, hovered, wake, hide };
}

/** Height of the fullscreen controls, so Up next and toasts can sit just above them. */
function useHeight(ref: { current: HTMLElement | null }, active: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, ref]);
  return height;
}

/** `theater`: on wide screens, full window width and as tall as fits above the controls. */
export function PlayerFrame({ theater }: { theater?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ws = wsClient.value;
    if (!containerRef.current || !ws) return;
    let detach: (() => void) | null = null;
    let cancelled = false;
    void attachPlayer(PLAYER_ID, ws).then((d) => {
      if (cancelled) d();
      else detach = d;
    });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  const controls = useFullscreenControls();
  const contentRef = useRef<HTMLDivElement>(null);
  const hasTrack = session.value?.current != null;
  const controlsHeight = useHeight(contentRef, controls.on && hasTrack);
  const lift = controls.shown && hasTrack ? controlsHeight + LIFT_GAP_PX : 0;

  return (
    <div
      id={STAGE_ID}
      // The iframe ignores pointers (it is display-only), so a double-click lands here, as on YouTube.
      // select-none keeps that double-click from highlighting the frame.
      onDblClick={(e) => {
        if (e.target === e.currentTarget) toggleFullscreen();
      }}
      onPointerMove={(e) => {
        if (controls.on && e.pointerType === "mouse") controls.wake();
      }}
      onPointerDown={(e) => {
        // Touch has no hover: a tap on the video shows or hides the controls.
        if (!controls.on || e.pointerType === "mouse" || e.target !== e.currentTarget) return;
        if (controls.shown) controls.hide();
        else controls.wake();
      }}
      style={{ "--lift": `${lift}px` }}
      class={cn(
        "relative aspect-video w-full select-none overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/40 ring-1 ring-line [&_iframe]:pointer-events-none [&_iframe]:size-full",
        theater && "lg:mx-auto lg:h-(--theater-h) lg:w-auto lg:max-w-full lg:rounded-none lg:shadow-none lg:ring-0",
        "[&:fullscreen]:rounded-none [&:fullscreen]:ring-0",
        controls.on && !controls.shown && "cursor-none",
      )}
    >
      <div id={PLAYER_ID} ref={containerRef}></div>
      <EmptyStage />
      <UpNext />
      {controls.on && hasTrack && (
        <div
          ref={controls.overlayRef}
          aria-hidden={!controls.shown}
          class={cn(
            "absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/45 to-transparent px-4 pt-24 pb-3 transition-opacity duration-300 sm:px-8 sm:pb-5",
            controls.shown ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") controls.hovered.current = true;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            controls.hovered.current = false;
            controls.wake();
          }}
          onPointerDown={(e) => {
            // A tap on the gradient itself counts as a tap on the video.
            if (e.pointerType !== "mouse" && e.target === e.currentTarget) controls.hide();
            else controls.wake();
          }}
          // A clicked button keeps focus, which would hold the controls up; only keyboard focus should.
          onPointerUp={() => {
            const el = document.activeElement;
            if (el instanceof HTMLElement && controls.overlayRef.current?.contains(el)) el.blur();
          }}
        >
          <div ref={contentRef}>
            <NowPlaying overlay />
          </div>
        </div>
      )}
      {fullscreen.value && <Toast />}
    </div>
  );
}
