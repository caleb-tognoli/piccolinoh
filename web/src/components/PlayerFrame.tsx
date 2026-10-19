import { useEffect, useRef } from "preact/hooks";
import { attachPlayer } from "../player";
import { wsClient } from "../store";

const PLAYER_ID = "yt-player";

export function PlayerFrame() {
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
    <div class="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/40 ring-1 ring-line [&>*]:size-full">
      <div id={PLAYER_ID} ref={containerRef}></div>
    </div>
  );
}
