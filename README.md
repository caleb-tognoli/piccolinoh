# piccolinoh

A Discord music bot.

## Prerequisites

- Node.js 20 or newer
- Docker Desktop (for the local Lavalink node)
- A Discord application with a bot user (token, client ID)
- A test guild ID for local development

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
# fill DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, LAVALINK_PASSWORD
```

## Running Lavalink locally

```bash
docker compose up -d
docker compose logs -f lavalink
```

First boot downloads the `youtube-plugin` JAR into `lavalink/plugins/` (~5 s). The container binds to `127.0.0.1:2333` only.

## Running the bot

```bash
pnpm dev
```

On startup the bot logs in, waits up to 10 s for a `node connected` line from Lavalink, then registers commands per-guild. Try `/ping` for latency and `/search <query>` to confirm audio search works.

## Scripts

- `pnpm dev` — run with tsx watch mode
- `pnpm typecheck` — tsc --noEmit
- `pnpm build` — compile to `dist/`
- `pnpm start` — run the compiled build
