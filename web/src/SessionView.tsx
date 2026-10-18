import { useEffect, useRef } from "preact/hooks";
import { Controls } from "./Controls";
import { attachPlayer } from "./player";
import { presence, sendControl, session, toast, wsClient } from "./store";

const PLAYER_ID = "yt-player";

function formatSec(n: number): string {
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function PlayerFrame() {
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
    <div class="player-wrapper">
      <div id={PLAYER_ID} ref={containerRef}></div>
    </div>
  );
}

function Members() {
  const members = presence.value;
  return (
    <div class="panel">
      <h3>Room ({members.length})</h3>
      <ul>
        {members.map((m) => (
          <li key={m.id}>{m.displayName ?? "Guest"}</li>
        ))}
      </ul>
    </div>
  );
}

function Queue() {
  const queue = session.value?.queue ?? [];
  return (
    <div class="panel queue">
      <h3>Queue</h3>
      {queue.length === 0 ? (
        <p class="empty">Empty</p>
      ) : (
        <ol>
          {queue.map((track, index) => (
            <li>
              <span class="title" title={`${track.title} — ${track.author}`}>
                {track.title}
              </span>
              <span class="duration">{formatSec(track.durationSec)}</span>
              <button aria-label="remove" onClick={() => sendControl({ kind: "remove", index })}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SessionView() {
  const current = session.value?.current;
  return (
    <div class="session-view">
      <div class="main">
        <PlayerFrame />
        <div class="now-playing">
          {current ? (
            <p>
              <strong>{current.title}</strong> <span class="author">— {current.author}</span>
            </p>
          ) : (
            <p class="empty">Nothing playing</p>
          )}
        </div>
        <Controls />
      </div>
      <div class="sidebar">
        <Members />
        <Queue />
      </div>
      {toast.value && <div class="toast">{toast.value}</div>}
    </div>
  );
}
