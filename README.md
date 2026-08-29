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
- A **YouTube Data API v3 key** (see below).
- Docker Desktop, for the one-command run flow.

## YouTube API key

`/play` searches YouTube by text via `search.list` (100 units per query)
and looks up durations via `videos.list` (1 unit). The free tier is
10 000 units per project per day, so budget stays comfortable for a
private bot: ~99 text queries per day, effectively unlimited URLs.

Mint a key:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (any name).
3. Under **APIs & Services → Enabled APIs**, enable **YouTube Data API v3**.
4. Under **APIs & Services → Credentials**, click **Create Credentials →
   API key**.
5. (Recommended) restrict the key to **YouTube Data API v3** so a leak
   can't be misused for other Google services.
6. Copy the key into `.env` as `YOUTUBE_API_KEY=...`.

If you exhaust the daily quota, `/play <text>` replies "Search budget
used — paste a link." — a URL-based `/play` still works while quota
allows (1 unit per lookup).

## Setup

```bash
corepack pnpm install
cp .env.example .env
# fill DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, YOUTUBE_API_KEY
```

## Running — Docker (single container, recommended)

```bash
docker compose up --build
```

The container serves everything on port `3000`: the watchtogether HTTP +
WebSocket API, the built web page, and the Discord bot process. Data
(SQLite cache + quota + guild settings) persists in a named Docker
volume `piccolinoh_data`.

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

Two terminals, with Vite hot-reloading the browser page:

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
