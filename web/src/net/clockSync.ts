import { serverOffset } from "../state/store";
import type { WSClient } from "./ws";

const PING_COUNT = 5;
const RESAMPLE_MS = 60_000;

export function startClockSync(ws: WSClient): () => void {
  let cancelled = false;

  const sample = (): void => {
    if (cancelled) return;
    const offsets: number[] = [];

    const unsub = ws.on("pong", (msg) => {
      const rtt = performance.now() - msg.t0;
      const offset = msg.serverMs - (msg.t0 + rtt / 2);
      offsets.push(offset);
      if (offsets.length >= PING_COUNT) {
        unsub();
        const sorted = [...offsets].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        serverOffset.value = median;
      }
    });

    for (let i = 0; i < PING_COUNT; i++) {
      ws.send({ type: "ping", t0: performance.now() });
    }
  };

  sample();
  const interval = window.setInterval(sample, RESAMPLE_MS);

  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}

export function serverNow(): number {
  return performance.now() + serverOffset.value;
}
