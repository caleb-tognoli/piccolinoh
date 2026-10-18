# piccolinoh

A YouTube watch-together website controlled by a Discord bot.

Everyone in the room opens the site, which runs the official YouTube player in
their browser. A small server owns the shared timeline (what's playing, where,
paused or not) and keeps every player in sync over a WebSocket. The Discord bot
is the remote control: it finds videos and manages the queue.

## How it fits together

```
Discord ──slash commands──▶ bot ──applyControl──▶ session (per guild) ──WebSocket──▶ browsers
                             │                                                       (YouTube player)
                             └──▶ Lavalink / Spotify API (finding videos)
```

Everything runs in one Node process (`src/main.ts`), next to a Lavalink
container that is used **only** to turn links and searches into video metadata.

- `src/watchtogether/` — the shared session: timeline math (`timeline.ts`),
  control actions (`control.ts`), WebSocket protocol (`ws.ts`, `protocol.ts`),
  HTTP server that also serves the built site (`server.ts`).
- `src/bot/` — the Discord bot: slash commands (`commands.ts`), video lookup
  (`resolver.ts`, `spotify.ts`), embeds, and the live queue message (`board.ts`).
- `src/joinToken.ts` — signed tokens in `/join` links so browsers show your
  Discord name.
- `web/` — the site (Vite + Preact).
- `tests/` — Vitest suites.

Sessions live in memory: restarting the process clears queues.

## Finding videos

`/play <query>` accepts:

- a YouTube video, Shorts, or playlist link;
- free text — the top YouTube search result is queued;
- a Spotify **track** or **album** link (needs `SPOTIFY_CLIENT_ID` /
  `SPOTIFY_CLIENT_SECRET`). Each track is matched to a YouTube video by
  searching `<artist> <title>`. Spotify playlists can't be read with Client
  Credentials, so they are rejected with a hint.

## Commands

| Command | |
| --- | --- |
| `/join` | Your personal (ephemeral) link to the site |
| `/play <query>` | Queue videos; posts a live queue message in the channel |
| `/pause`, `/resume`, `/skip` | Transport controls |
| `/np`, `/queue`, `/history` | What's playing, what's next, what played |
| `/remove <position>`, `/move <from> <to>`, `/clear` | Edit the queue |
| `/replay` | Queue the current video again |
| `/autoplay <enabled>` | When off, playback stops after each video |

The site itself offers play/pause, skip, seek and removing queue items.

## Setup

Requires Node.js 22+, Docker, and a Discord application with a bot user.

```bash
corepack pnpm install
cp .env.example .env   # fill DISCORD_TOKEN, DISCORD_GUILD_ID, JOIN_TOKEN_SECRET, LAVALINK_PASSWORD
```

### Run with Docker

```bash
docker compose up --build
```

Serves the site, WebSocket and bot on port `3000`, with Lavalink alongside.

### Local development

```bash
docker compose up lavalink   # expose it with ports: ["2333:2333"] and set LAVALINK_URL=http://localhost:2333
corepack pnpm dev            # bot + server on :3000
corepack pnpm dev:web        # Vite on :5173, proxies /ws to :3000
```

Open the link from `/join`, replacing the host with `localhost:5173`.

## Scripts

- `corepack pnpm typecheck` — server, tests and web
- `corepack pnpm test` — Vitest
- `corepack pnpm build` / `build:web` — production builds; `start` runs them
