# piccolinoh

A Discord music bot.

## Prerequisites

- Node.js 20 or newer
- A Discord application with a bot user (token, client ID)
- A test guild ID for local development

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
# fill DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
pnpm dev
```

Run `/ping` in your test server to verify the bot is up.

## Scripts

- `pnpm dev` — run with tsx watch mode
- `pnpm typecheck` — tsc --noEmit
- `pnpm build` — compile to `dist/`
- `pnpm start` — run the compiled build
