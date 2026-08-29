import { session, toast } from "../state/store";
import { Controls } from "./Controls";
import { Members } from "./Members";
import { PlayerFrame } from "./PlayerFrame";
import { Queue } from "./Queue";

export function SessionView() {
  const cur = session.value?.current;
  return (
    <div class="session-view">
      <div class="main">
        <PlayerFrame />
        <div class="now-playing">
          {cur ? (
            <p>
              <strong>Playing:</strong>{" "}
              <span class="video-id">{cur.videoId}</span>
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
