import "dotenv/config";
import { z } from "zod";

function emptyToUndefined(v: unknown): unknown {
  return typeof v === "string" && v.trim() === "" ? undefined : v;
}

const schema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
    DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, "DISCORD_CLIENT_ID must be a snowflake"),
    DISCORD_GUILD_ID: z.string().regex(/^\d{17,20}$/, "DISCORD_GUILD_ID must be a snowflake"),
    HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LAVALINK_URL: z.string().url().default("http://lavalink:2333"),
    LAVALINK_PASSWORD: z.string().min(1, "LAVALINK_PASSWORD is required"),
    PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
    SQLITE_PATH: z.string().min(1).default("./data/piccolinoh.db"),
    JOIN_TOKEN_SECRET: z.string().min(32, "JOIN_TOKEN_SECRET must be at least 32 characters"),
    SPOTIFY_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SPOTIFY_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .refine(
    (c) => !!c.SPOTIFY_CLIENT_ID === !!c.SPOTIFY_CLIENT_SECRET,
    {
      message:
        "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must both be set or both empty",
      path: ["SPOTIFY_CLIENT_ID"],
    },
  );

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
export type Config = typeof config;
