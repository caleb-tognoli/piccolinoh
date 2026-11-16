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

Each server has one room, kept in a SQLite file (`src/db.ts`,
`src/watchtogether/store.ts`, Node's built-in `node:sqlite`) at
`$DATA_DIR/piccolinoh.db`. A room's id never changes, so `/join` links keep
working across restarts, and its queue, history and autoplay setting come back
with it; whatever was playing comes back paused where it was. Changes are
written about a second after they happen and everything is saved on shutdown.
Removing the bot from a server deletes that server's room, its play log and
its playlists.

The same file keeps a **play log** for stats (`src/watchtogether/plays.ts`):
one row per track that played in a room, with who added it, how long it
actually played (paused time doesn't count), how it ended (finished, skipped,
auto-skipped, or interrupted by a crash), who skipped it and the playlist it
was queued from, plus which named
people had the room open while it played. People are recorded by Discord user
id, which `/join` links now carry; anonymous guests aren't recorded.
`/privacy count_me:False` leaves someone out of a server's log from then on;
what was already recorded about them stays.

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
| `/playlist …` | The server's playlists (see below) |
| `/privacy <count_me>` | Whether your listening and picks count in this server's stats (ephemeral) |

Queued tracks show who added them, in Discord and on the site.

## Playlists

Each server keeps its own playlists (`src/watchtogether/playlists.ts`,
`src/bot/playlists.ts`): named, frozen lists of videos that anyone in the
server can queue or edit. Names are unique per server ignoring case (up to 50
characters), and autocomplete in every subcommand.

| Command | |
| --- | --- |
| `/playlist play <name> [next] [shuffle]` | Queue a playlist |
| `/playlist add <name> <query>` | Add anything `/play` accepts (a YouTube playlist or Spotify album is copied once) |
| `/playlist save <name> [what]` | Add what's playing and/or the queue |
| `/playlist show <name>` | The playlist, paged, with queue all / play next / delete, and queue / up / down / remove per track (ephemeral) |
| `/playlist list` | Every playlist with its length (ephemeral) |
| `/playlist rename <name> <new_name>`, `/playlist delete <name>` | |

- `add` and `save` make the playlist if it's new. Videos already in it are
  skipped; a playlist holds up to 500 tracks (what doesn't fit is left out)
  and a server up to 100 playlists.
- Tracks are stored as they were found (id, title, channel, length), so
  queueing is instant and never looks anything up again.
- Each track remembers who added it, and the playlist who made it, whatever
  their `/privacy` setting: that's attribution, not stats.
- Queued tracks are credited to whoever queued the playlist and carry its name
  (as it was then), shown as a badge in the site's queue and kept in the play
  log as `playlist_id` (cleared if the playlist is deleted).
- Editing replies privately. Queueing posts the usual log line; deleting asks
  first, then posts `-# Caleb deleted playlist **Chill** (24 tracks)`. A
  track removed in `/playlist show` can be put back for 30 s.
- The site has all of it too (see below).

The bot keeps one **player** message per server, always at the bottom of its
channel: what's playing (who added it on a small line under the artist), its
length with a live "ends in 2 minutes" countdown (a still progress bar while
paused), and Pause/Resume, Skip and Join buttons. Above it runs the **action
log**, one small line per thing that happened:

- a command's reply is its line (`-# Queued **Song** (#3)`, under Discord's
  "Caleb used /play"); errors are only shown to whoever ran it;
- button clicks and site actions post `-# Caleb skipped **Song**`, and quick
  repeats by the same person edit that line instead of adding one
  (`-# Caleb queued **A**, **B**`). Ordinary track changes only update the
  player.

The player is never edited: whenever what it shows changes, it's re-posted
at the bottom and the old one deleted, so Discord doesn't mark it "(edited)".
Its countdown is a Discord timestamp that ticks by itself. `/np` moves it down
by hand. When nothing is left it collapses to a one-line idle state.

The bot needs View Channel, Send Messages and Read Message History in the
channels it's used in; without Send Messages the player is posted as a
follow-up to each command instead.

The site itself offers play/pause, skip, seek and removing queue items, and its
"Autoplay off" pill turns autoplay back on.

People who opened the site with their `/join` link (so it knows their Discord
id) can also add tracks and use playlists there; guests with just the room's
address can only look at playlists. Requests and replies go over the same
WebSocket (`src/watchtogether/playlistApi.ts`), and every browser in the room
is sent playlist changes as they happen, wherever they were made.

- **Add box** at the top of the queue, and in an open playlist: results show
  as you type in a popover under it (from 3 characters, after a 0.6 s pause;
  Enter searches at once and, once results show, adds the top one), with
  queue, play next and save to playlist on each. A YouTube video link shows
  its video right away. YouTube playlist and Spotify links are only named
  until you add them, then looked up one at a time. Lookups use the same code as `/play` (handed to the server
  in `src/main.ts`, see `src/watchtogether/lookups.ts`), and each person gets
  25 searches or link lookups a minute. A picked search result is checked for
  embedding before it's added.
- **Playlists** card under the room: the list (queue one, or make a new one),
  and a playlist opened in place: click its name to rename it, queue it, delete
  it (confirmed, then logged in Discord), and per track queue, drag to reorder
  and remove with undo.
- **Queue button** wherever something can be added: "+ Queue" with an arrow for
  Next and (for playlists and albums) Shuffled; "+ Add" in a playlist. Row
  actions in the queue and playlists show on hover (always on touch screens).
- **Save to playlist** on what's playing, each queue item, the whole queue and
  recently played: a picker with recently used playlists first, ticks on
  those already holding the video, and "New playlist…".

## Setup

Requires Node.js 22.13+ (for `node:sqlite`) and a Discord application with a bot user (Docker optional).

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
`restart: unless-stopped` brings it back. Rooms are kept in `./data` on the
host, mounted at `/app/data`.

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
