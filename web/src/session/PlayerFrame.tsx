import { useEffect, useRef } from "preact/hooks";
import { attachPlayer } from "../player/shim";
import { wsClient } from "../state/store";

const CONTAINER_ID = "yt-player";

export function PlayerFrame() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    const ws = wsClient.value;
    if (!el || !ws) return;
    el.id = CONTAINER_ID;
    let detach: (() => void) | null = null;
    let cancelled = false;
    attachPlayer(CONTAINER_ID, ws).then((d) => {
      if (cancelled) {
        d();
        return;
      }
      detach = d;
    });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  return (
    <div class="player-wrapper">
      <div ref={containerRef}></div>
    </div>
  );
}
