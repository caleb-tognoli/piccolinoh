import { session, wsClient } from "../state/store";

function formatSec(n: number): string {
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Queue() {
  const queue = session.value?.queue ?? [];
  return (
    <div class="queue">
      <h3>Queue</h3>
      {queue.length === 0 ? (
        <p class="empty">Empty</p>
      ) : (
        <ol>
          {queue.map((item, index) => (
            <li>
              <span class="video-id" title={item.videoId}>
                {item.videoId}
              </span>
              <span class="duration">{formatSec(item.durationSec)}</span>
              <button
                aria-label="remove"
                onClick={() =>
                  wsClient.value?.send({ type: "control", action: { kind: "remove", index } })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
