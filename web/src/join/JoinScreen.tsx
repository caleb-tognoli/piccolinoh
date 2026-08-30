import { useState } from "preact/hooks";
import { connect } from "../net/ws";
import { startClockSync } from "../net/clockSync";
import { displayName, phase, presence, serverOffset, session, wsClient } from "../state/store";

const STATE_TIMEOUT_MS = 10_000;

function parseHash(): { sessionToken: string; joinToken: string | null; presetName: string | null } {
  const raw = location.hash.slice(1).trim();
  if (!raw) return { sessionToken: "", joinToken: null, presetName: null };
  const [sessionToken, ...rest] = raw.split("&");
  let joinToken: string | null = null;
  for (const part of rest) {
    if (part.startsWith("t=")) joinToken = part.slice(2);
  }
  let presetName: string | null = null;
  if (joinToken) {
    // Peek at the token's payload for a display name so the input is prefilled
    // instantly. The server does the real verification; the browser never
    // trusts this value beyond the initial UI hint.
    const parts = joinToken.split(".");
    if (parts.length === 2 && parts[0]) {
      try {
        const pad = parts[0].length % 4 === 0 ? "" : "=".repeat(4 - (parts[0].length % 4));
        const decoded = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/") + pad);
        const payload = JSON.parse(decoded) as { dn?: unknown };
        if (typeof payload.dn === "string") presetName = payload.dn;
      } catch {
        // ignore — token might be malformed; fall back to manual entry
      }
    }
  }
  return { sessionToken: sessionToken ?? "", joinToken, presetName };
}

export function JoinScreen() {
  const parsed = parseHash();
  const hasToken = !!parsed.joinToken;
  const initialName = parsed.presetName ?? (displayName.value === "Guest" ? "" : displayName.value);
  const [name, setName] = useState(initialName);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = (): void => {
    if (!parsed.sessionToken) {
      setError("no session token in URL");
      return;
    }
    setJoining(true);
    setError(null);
    displayName.value = (name.trim() || parsed.presetName || "Guest");

    const wsUrl = `${location.protocol.replace("http", "ws")}//${location.host}/ws`;
    const client = connect(wsUrl, {
      onOpen: () => {
        client.send({
          type: "hello",
          sessionToken: parsed.sessionToken,
          ...(parsed.joinToken ? { joinToken: parsed.joinToken } : {}),
        });
      },
      onReconnect: () => {
        client.send({
          type: "hello",
          sessionToken: parsed.sessionToken,
          ...(parsed.joinToken ? { joinToken: parsed.joinToken } : {}),
        });
      },
    });

    const timeout = window.setTimeout(() => {
      client.close();
      setJoining(false);
      setError(
        "Server didn't respond in time. Is the state server running? Check the browser console for WebSocket errors.",
      );
    }, STATE_TIMEOUT_MS);

    client.on("state", (msg) => {
      window.clearTimeout(timeout);
      if (serverOffset.value === 0) {
        serverOffset.value = msg.serverMs - performance.now();
      }
      session.value = msg.session;
      if (phase.value === "join") phase.value = "session";
    });
    client.on("queueUpdate", (msg) => {
      const s = session.value;
      if (s) session.value = { ...s, queue: msg.queue };
    });
    client.on("presence", (msg) => {
      presence.value = msg.members;
    });

    wsClient.value = client;
    startClockSync(client);
  };

  return (
    <div class="join-screen">
      <h1>piccolinoh</h1>
      {hasToken ? (
        <p>Joining as <strong>{parsed.presetName ?? "you"}</strong>.</p>
      ) : (
        <p>Join this listening session in your browser.</p>
      )}
      {!parsed.sessionToken && (
        <p class="error">No session token in URL. Paste the link with a `#&lt;token&gt;` suffix.</p>
      )}
      {!hasToken && (
        <label>
          <span>Display name</span>
          <input
            type="text"
            value={name}
            placeholder="Guest"
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      )}
      <button onClick={handleJoin} disabled={joining || !parsed.sessionToken}>
        {joining ? "Joining…" : hasToken ? "Tap to start" : "Join & start"}
      </button>
      {error && <p class="error">{error}</p>}
    </div>
  );
}
