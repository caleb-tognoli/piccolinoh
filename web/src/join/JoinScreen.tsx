import { useState } from "preact/hooks";
import { connect } from "../net/ws";
import { startClockSync } from "../net/clockSync";
import { displayName, phase, presence, serverOffset, session, wsClient } from "../state/store";

const STATE_TIMEOUT_MS = 10_000;

export function JoinScreen() {
  const initialName = displayName.value === "Guest" ? "" : displayName.value;
  const [name, setName] = useState(initialName);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = location.hash.slice(1).trim();

  const handleJoin = (): void => {
    if (!token) {
      setError("no session token in URL");
      return;
    }
    setJoining(true);
    setError(null);
    displayName.value = name.trim() || "Guest";

    const wsUrl = `${location.protocol.replace("http", "ws")}//${location.host}/ws`;
    const client = connect(wsUrl, {
      onOpen: () => {
        client.send({ type: "hello", sessionToken: token });
      },
      onReconnect: () => {
        client.send({ type: "hello", sessionToken: token });
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
      // Seed serverOffset from the state message immediately so the shim's
      // derivedPosition returns something sensible before clockSync's 5-ping
      // median lands. Ignores one-way network latency (usually < 100 ms),
      // which is well below the 2 s sync dead-zone.
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
      <p>Join this listening session in your browser.</p>
      {!token && <p class="error">No session token in URL. Paste the link with a `#&lt;token&gt;` suffix.</p>}
      <label>
        <span>Display name</span>
        <input
          type="text"
          value={name}
          placeholder="Guest"
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button onClick={handleJoin} disabled={joining || !token}>
        {joining ? "Joining…" : "Join & start"}
      </button>
      {error && <p class="error">{error}</p>}
    </div>
  );
}
