# piccolinoh

A Discord music bot backed by a client-side synced-embed architecture.
Discord is the control plane; each listener's browser runs the YouTube
IFrame Player and syncs against a small authoritative timeline on the
server. See [MIGRATION.md](MIGRATION.md) for the history.

## Status

Phase 3 shipped: the Discord bot is a real consumer of `watchtogether`.
`/play`, `/skip`, `/pause`, `/resume`, `/queue`, `/remove`, `/np`,
`/session`, `/settings skipmode` all wired. Vote-skip / DJ enforcement /
`/playlist` / `/replay` / autoplay-off are Phase 4.

## Repository layout

- `src/main.ts` — composition root; boots watchtogether then the bot.
- `src/watchtogether/` — session model + timeline + WS/HTTP server, plus a
  small public API (`index.ts`) that outside consumers depend on.
- `src/bot/` — Discord bot; only imports from `src/watchtogether/index.ts`.
- `web/` — Vite + Preact browser page (workspace package `@piccolinoh/web`).
- `tests/` — Vitest suites (timeline math, WS protocol, extracted control,
  guild-session store).
- `Dockerfile` / `docker-compose.yml` — single-container deploy.
- `MIGRATION.md` — record of what was removed from the previous audio path.

## Prerequisites

- Node.js 22.5 or newer (Node 24 is fine; the code uses the built-in
  `node:sqlite` module).
- `corepack pnpm ...` is used throughout — bare `pnpm` on PATH is only
  there if you've run `corepack enable` as admin.
- A Discord application with a bot user (token, client ID).
- A test guild ID for local development.
- Docker Desktop, for the one-command run flow (also brings up Lavalink).

## Lavalink (search resolver)

`/play` turns text or a YouTube URL into `{videoId, title, author,
durationSec}` by calling Lavalink's `GET /v4/loadtracks`. The compose
stack ships a Lavalink container with the `youtube-source` plugin
pre-configured for resolution only — no audio ever streams through it,
so poToken / OAuth / IP-flag drama does not apply. There is no daily
search cap.

The only knob is `LAVALINK_PASSWORD`: pick any non-empty string in
`.env`, and compose passes the same value to both the bot and Lavalink.
Only the compose network sees the port (`2333`) — it is not exposed on
the host.

## Setup

```bash
corepack pnpm install
cp .env.example .env
# fill DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, LAVALINK_PASSWORD
```

## Running — Docker (single container, recommended)

```bash
docker compose up --build
```

The `piccolinoh` container serves everything on port `3000`: the
watchtogether HTTP + WebSocket API, the built web page, and the Discord
bot process. It depends on a sidecar `lavalink` container that starts
alongside it. Data (SQLite video/query cache + guild settings) persists
in a named Docker volume `piccolinoh_data`. Lavalink downloads the
youtube-plugin JAR on cold start (a few seconds); it is not persisted.

In Discord:

- `/session` — posts a join link. Open it in a browser, click **Join & start**.
- `/play <query or URL>` — enqueues a track. Now-playing embed pins in
  the channel you invoked from.
- `/pause`, `/resume`, `/skip`, `/queue`, `/remove <n>`, `/np` — do
  what they say.
- `/settings skipmode <anyone|vote|dj>` — stored today; Phase 4 will
  start enforcing it.

To stop:

```bash
docker compose down
```

## Running — local dev with HMR

Three terminals: Lavalink (via docker), the server, and Vite:

```bash
docker compose up lavalink
```

Then in `.env` (for local dev only) set `LAVALINK_URL=http://localhost:2333`
so the host-side Node process can reach the container. Expose the port
from compose while iterating (`ports: ["2333:2333"]` under the
`lavalink` service) if you have not already.

```bash
corepack pnpm dev
```

Runs the Discord client + watchtogether server (HTTP + WebSocket on `:3000`).

```bash
corepack pnpm dev:web
```

Runs Vite on `:5173`, proxying `/api` and `/ws` back to `:3000`.

Then browse to `http://localhost:5173/?dev=1#<sessionId>`.

## Scripts

- `corepack pnpm dev` / `corepack pnpm dev:web` — dev servers.
- `corepack pnpm typecheck` — typechecks server, tests, and web.
- `corepack pnpm test` — runs the Vitest suites.
- `corepack pnpm build` / `corepack pnpm build:web` — production builds.
- `corepack pnpm start` — run the compiled server build (serves `web/dist` too if it exists).
