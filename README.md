# piccolinoh

A Discord music bot, in the middle of a migration to a client-side
synced-embed architecture. See [MIGRATION.md](MIGRATION.md) for the
rationale and phase plan.

## Status

Phase 2 landed: a Preact web client runs the YouTube IFrame Player in
every listener's browser and stays in sync with the conductor server's
timeline over WebSocket. Phase 3 (Discord bot commands wired to the
state server) still to come.

## Repository layout

- `src/` — Node.js side: Discord client, state server, WebSocket handlers.
- `web/` — Vite + Preact browser page (workspace package `@piccolinoh/web`).
- `tests/` — Vitest suites covering the state server.
- `Dockerfile` / `docker-compose.yml` — single-container deploy.
- `MIGRATION.md` — record of what was removed from the previous audio path.

## Prerequisites

- Node.js 20 or newer (Node 22 recommended)
- `corepack pnpm ...` is used throughout — `pnpm` on PATH is only there
  if you've run `corepack enable` as admin.
- A Discord application with a bot user (token, client ID)
- A test guild ID for local development
- Docker Desktop, if you want the one-command run flow

## Setup

```bash
corepack pnpm install
cp .env.example .env
# fill DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
```

## Running — Docker (single container, recommended)

```bash
docker compose up --build
```

Then in your browser open `http://localhost:3000/?dev=1#<sessionId>`
after creating a session:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"guildId":"test"}'
```

Everything — Discord bot, state server, WebSocket, and the built web
page — runs from that one container on port `3000`. No Vite proxy in
the loop.

To stop:

```bash
docker compose down
```

## Running — local dev with HMR

Two terminals, with Vite hot-reloading the browser page:

```bash
corepack pnpm dev
```

Runs the Discord client + state server (HTTP + WebSocket on `:3000`).

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
