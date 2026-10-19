import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-preact";
import { useState } from "preact/hooks";
import { Logo } from "./components/Logo";
import { connect, startClockSync } from "./net";
import { presence, serverOffset, session, wsClient } from "./store";
import { Button } from "./ui/Button";

const STATE_TIMEOUT_MS = 10_000;

// Join links look like `/#<sessionId>&t=<joinToken>` (see /join in the bot).
function parseHash(): { sessionId: string; joinToken?: string; name?: string } {
  const [sessionId = "", ...params] = location.hash.slice(1).trim().split("&");
  const joinToken = params.find((p) => p.startsWith("t="))?.slice(2);
  // Peek at the token payload for the display name. Only a UI hint — the
  // server verifies the token itself.
  let name: string | undefined;
  try {
    const payloadB64 = joinToken?.split(".")[0];
    if (payloadB64) {
      const bytes = Uint8Array.from(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as { dn?: unknown };
      if (typeof payload.dn === "string") name = payload.dn;
    }
  } catch {
    // malformed token; join as a guest
  }
  return { sessionId, joinToken, name };
}

export function JoinScreen() {
  const { sessionId, joinToken, name } = parseHash();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The click doubles as the user gesture browsers require before autoplaying video.
  const join = (): void => {
    setJoining(true);
    setError(null);

    const client = connect(`${location.protocol.replace("http", "ws")}//${location.host}/ws`, () =>
      client.send({ type: "hello", sessionId, ...(joinToken ? { joinToken } : {}) }),
    );
    const timeout = window.setTimeout(() => {
      client.close();
      setJoining(false);
      setError("The server didn't respond. Is it running?");
    }, STATE_TIMEOUT_MS);

    client.on("state", (msg) => {
      window.clearTimeout(timeout);
      if (serverOffset.value === 0) serverOffset.value = msg.serverMs - performance.now();
      session.value = msg.session;
    });
    client.on("presence", (msg) => {
      presence.value = msg.members;
    });

    wsClient.value = client;
    startClockSync(client);
  };

  return (
    <main class="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,--theme(--color-accent/12%),transparent_60%)] p-6">
      <div class="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <Logo large />
        {sessionId ? (
          <p class="text-muted">
            {name ? (
              <>
                Joining as <strong class="font-semibold text-ink">{name}</strong>.
              </>
            ) : (
              "Join this watch session."
            )}
          </p>
        ) : (
          <Alert>No session in this link. Use /join in Discord to get one.</Alert>
        )}
        <Button variant="primary" size="lg" class="w-full" onClick={join} disabled={joining || !sessionId}>
          {joining ? (
            <>
              <LoaderCircle class="size-5 animate-spin" /> Joining…
            </>
          ) : (
            <>
              Tap to start <ArrowRight class="size-5" />
            </>
          )}
        </Button>
        {error && <Alert>{error}</Alert>}
      </div>
    </main>
  );
}

function Alert({ children }: { children: string }) {
  return (
    <p role="alert" class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-left text-sm text-danger">
      <CircleAlert class="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}
