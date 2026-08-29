import { useState } from "preact/hooks";
import type { ControlAction } from "../net/protocol";
import { session, wsClient } from "../state/store";

function send(action: ControlAction): void {
  wsClient.value?.send({ type: "control", action });
}

export function Controls() {
  const cur = session.value?.current;
  const paused = cur?.pausedAtPositionSec != null;
  const isDev = new URLSearchParams(location.search).has("dev");

  return (
    <div class="controls">
      {cur ? (
        <>
          <button onClick={() => send({ kind: paused ? "play" : "pause" })}>
            {paused ? "▶ Play" : "⏸ Pause"}
          </button>
          <button onClick={() => send({ kind: "skip" })}>⏭ Skip</button>
          <SeekInput />
        </>
      ) : (
        <p class="empty-controls">Queue something to get started.</p>
      )}
      {isDev && <DevEnqueue />}
    </div>
  );
}

function parseTime(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const n = Number(parts[0]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return m * 60 + s;
  }
  return null;
}

function SeekInput() {
  const [text, setText] = useState("");
  return (
    <form
      class="seek-form"
      onSubmit={(e) => {
        e.preventDefault();
        const sec = parseTime(text);
        if (sec != null) {
          send({ kind: "seek", toSec: sec });
          setText("");
        }
      }}
    >
      <input
        type="text"
        placeholder="mm:ss"
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
      />
      <button type="submit">Seek</button>
    </form>
  );
}

// Phase 2 testing scaffolding — removed in Phase 3 once the bot handles enqueue.
function DevEnqueue() {
  const [vid, setVid] = useState("");
  const [dur, setDur] = useState("");
  return (
    <form
      class="dev-enqueue"
      onSubmit={(e) => {
        e.preventDefault();
        const d = Number(dur);
        if (vid && d > 0) {
          send({ kind: "enqueue", videoId: vid, durationSec: d });
          setVid("");
          setDur("");
        }
      }}
    >
      <div class="dev-label">dev · enqueue</div>
      <input
        type="text"
        placeholder="videoId (e.g. dQw4w9WgXcQ)"
        value={vid}
        onInput={(e) => setVid((e.currentTarget as HTMLInputElement).value)}
      />
      <input
        type="number"
        placeholder="duration (sec)"
        value={dur}
        min={1}
        onInput={(e) => setDur((e.currentTarget as HTMLInputElement).value)}
      />
      <button type="submit">Enqueue</button>
    </form>
  );
}
