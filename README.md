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
                             └──▶ YouTube (youtubei.js) / Spotify API (finding videos)
```

Everything runs in one Node process (`src/main.ts`).

- `src/watchtogether/` — the shared session: timeline math (`timeline.ts`),
  control actions (`control.ts`), WebSocket protocol (`ws.ts`, `protocol.ts`),
  HTTP server that also serves the built site (`server.ts`).
- `src/bot/` — the Discord bot: slash commands (`commands.ts`), video lookup
  (`resolver.ts`, `youtube.ts`, `spotify.ts`), embeds, and the live queue
  message (`board.ts`).
- `src/joinToken.ts` — signed tokens in `/join` links so browsers show your
  Discord name.
- `web/` — the site (Vite + Preact).
- `tests/` — Vitest suites.

Sessions live in memory: restarting the process clears queues.

## Finding videos

Lookups use [youtubei.js](https://github.com/LuanRT/YouTube.js), a client for
YouTube's internal API (no API key, no quota, metadata only). `/play <query>`
accepts:

- a YouTube video or Shorts link (a `watch?v=…&list=…` link queues just the
  video);
- a YouTube playlist link — up to 200 videos;
- free text — the first of the top 3 search results that allows embedding;
- a Spotify **track** or **album** link (needs `SPOTIFY_CLIENT_ID` /
  `SPOTIFY_CLIENT_SECRET`). Each track is matched by searching
  `<artist> <title>` on YouTube Music (songs), then regular YouTube, preferring
  an upload within 5 s of Spotify's length. Spotify playlists can't be read
  with Client Credentials, so they are rejected with a hint.

If a queued video still refuses to embed, browsers report it and the bot skips it
once most of the room has.

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

Requires Node.js 22+ and a Discord application with a bot user (Docker optional).

```bash
corepack pnpm install
cp .env.example .env   # fill DISCORD_TOKEN, DISCORD_GUILD_ID, JOIN_TOKEN_SECRET
```

### Run with Docker

```bash
docker compose up --build
```

Serves the site, WebSocket and bot on port `3000`.

### Local development

```bash
corepack pnpm dev            # bot + server on :3000
corepack pnpm dev:web        # Vite on :5173, proxies /ws to :3000
```

Open the link from `/join`, replacing the host with `localhost:5173`.

## Scripts

- `corepack pnpm typecheck` — server, tests and web
- `corepack pnpm test` — Vitest
- `corepack pnpm build` / `build:web` — production builds; `start` runs them
