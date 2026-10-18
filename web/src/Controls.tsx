import { useState } from "preact/hooks";
import { sendControl, session } from "./store";

/** "90", "1:30" -> seconds */
function parseTime(input: string): number | null {
  if (!input.trim()) return null;
  const parts = input.trim().split(":").map(Number);
  if (parts.length > 2 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function Controls() {
  const current = session.value?.current;
  const [seekText, setSeekText] = useState("");
  if (!current) return <p class="controls empty">Queue something with /play in Discord.</p>;

  const paused = current.pausedAtPositionSec != null;
  return (
    <div class="controls">
      <button onClick={() => sendControl({ kind: paused ? "play" : "pause" })}>
        {paused ? "▶ Play" : "⏸ Pause"}
      </button>
      <button onClick={() => sendControl({ kind: "skip" })}>⏭ Skip</button>
      <form
        class="seek-form"
        onSubmit={(e) => {
          e.preventDefault();
          const toSec = parseTime(seekText);
          if (toSec == null) return;
          sendControl({ kind: "seek", toSec });
          setSeekText("");
        }}
      >
        <input
          type="text"
          placeholder="mm:ss"
          value={seekText}
          onInput={(e) => setSeekText(e.currentTarget.value)}
        />
        <button type="submit">Seek</button>
      </form>
    </div>
  );
}
