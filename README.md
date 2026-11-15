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
- `src/bot/` — the Discord bot: slash commands (`commands.ts`), button clicks
  (`buttons.ts`), video lookup (`resolver.ts`, `youtube.ts`, `spotify.ts`),
  message rendering (`views.ts`) and the live player message (`player.ts`).
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

`/thisis <artist> [count]` is a "This Is"-style list built from YouTube Music
rather than Spotify (Spotify blocks Client Credentials apps from its own
playlists and from artist top tracks). It finds the artist, then queues up to
`count` songs (default 50, max 100): the top 3 most-played tracks of their two
newest releases from this or last year, followed by the artist page's
"Top songs" list (ranked by current plays, so new hits sit next to classics),
with each song listed once.

If a queued video still refuses to embed, browsers report it and the bot skips it
once most of the room has.

## Commands

| Command | |
| --- | --- |
| `/join` | Your personal (ephemeral) link to the site |
| `/play <query>` | Queue videos |
| `/playnext <query>` | Queue videos at the front of the queue |
| `/thisis <artist> [count]` | Queue an artist's newest and most popular songs |
| `/pause`, `/resume`, `/skip` | Transport controls |
| `/seek <time>` | Jump to `1:23` or `83`, or `+30` / `-10` from here |
| `/np` | Bring the player to the bottom of this channel |
| `/queue` | The queue, paged, with play-next / up / down / remove buttons per track (ephemeral) |
| `/history` | Recently played, with a button to queue each again (ephemeral) |
| `/remove <position>`, `/move <from> <to>`, `/shuffle`, `/clear` | Edit the queue |
| `/replay` | Queue the current video again |
| `/autoplay <enabled>` | When off, playback stops after each video |

The bot keeps one **player** message per server, always at the bottom of its
channel: what's playing with a progress bar (refreshed every 10 s), the next
track, and Pause/Resume, Skip, Queue and Join buttons. Above it runs the
**action log**, one small line per change worth keeping (queueing, clearing,
shuffling, autoplay, the queue running out):

- a command's reply is its line (`-# Queued **Song** (#3)`, under Discord's
  "Caleb used /play"); errors are only shown to whoever ran it;
- button clicks and site actions post `-# Caleb queued **Song** (#3)`, and
  quick repeats by the same person edit that line instead of adding one
  (`-# Caleb queued **A**, **B**`).

Passing actions (pause/resume, seeks, skips, auto-skips of unembeddable videos,
moving, removing and restoring queue items) don't post anything: the player's
footer shows the latest one for two minutes (`-# Caleb skipped **Song** · 1
minute ago`), stacking quick repeats the same way. Their slash commands reply
only to whoever ran them. Ordinary track changes only update the player.

After each new line the player re-posts below it, and it also re-posts once 5
other messages have buried it. `/np` moves it down by hand. When nothing is
left it collapses to a one-line idle state.

The bot needs View Channel, Send Messages and Read Message History in the
channels it's used in; without Send Messages the player is posted as a
follow-up to each command instead.

The site itself offers play/pause, skip, seek and removing queue items, and its
"Autoplay off" pill turns autoplay back on.

## Setup

Requires Node.js 22+ and a Discord application with a bot user (Docker optional).

```bash
corepack pnpm install
cp .env.example .env   # fill DISCORD_TOKEN, JOIN_TOKEN_SECRET
```

Slash commands are registered globally, so the bot works in every server it's
invited to, each with its own room. Set `DISCORD_GUILD_ID` to register them in
one server only, where changes show up instantly instead of after up to an
hour. Switching back to global removes those server-only commands.

### Run with Docker

```bash
docker compose up --build
```

Serves the site, WebSocket and bot on port `3000`. `/health` answers 503 while
the Discord connection is down, which Compose shows as unhealthy. If Discord
stays down for 5 minutes while no browser is connected, the process exits and
`restart: unless-stopped` brings it back.

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
