import { useEffect, useRef } from "preact/hooks";
import { attachPlayer } from "../player";
import { fullscreen, STAGE_ID, toggleFullscreen, wsClient } from "../store";
import { cn } from "../ui/cn";
import { EmptyStage } from "./EmptyStage";
import { Toast } from "./Toast";

const PLAYER_ID = "yt-player";

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
  return (
    <div
      id={STAGE_ID}
      // The iframe ignores pointers (it is display-only), so a double-click lands here, as on YouTube.
      onDblClick={(e) => {
        if (e.target === e.currentTarget) toggleFullscreen();
      }}
      class={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/40 ring-1 ring-line [&_iframe]:pointer-events-none [&_iframe]:size-full",
        theater && "lg:mx-auto lg:h-(--theater-h) lg:w-auto lg:max-w-full lg:rounded-none lg:shadow-none lg:ring-0",
        "[&:fullscreen]:rounded-none [&:fullscreen]:ring-0",
      )}
    >
      <div id={PLAYER_ID} ref={containerRef}></div>
      <EmptyStage />
      {fullscreen.value && <Toast />}
    </div>
  );
}
