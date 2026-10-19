import "dotenv/config";
import { z } from "zod";

const optional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const schema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
    DISCORD_GUILD_ID: z.string().regex(/^\d{17,20}$/, "DISCORD_GUILD_ID must be a snowflake"),
    HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
    JOIN_TOKEN_SECRET: z.string().min(32, "JOIN_TOKEN_SECRET must be at least 32 characters"),
    SPOTIFY_CLIENT_ID: optional,
    SPOTIFY_CLIENT_SECRET: optional,
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .refine((c) => !!c.SPOTIFY_CLIENT_ID === !!c.SPOTIFY_CLIENT_SECRET, {
    message: "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must both be set or both empty",
    path: ["SPOTIFY_CLIENT_ID"],
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
