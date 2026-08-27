import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { Collection } from "discord.js";
import { logger } from "../logger.js";
import { isCommand, type Command } from "./_types.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function loadCommands(): Promise<Collection<string, Command>> {
  const commands = new Collection<string, Command>();
  const entries = await readdir(here, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith("_")) continue;
    if (entry.name === "loader.ts" || entry.name === "loader.js") continue;
    if (!/\.(?:ts|js)$/.test(entry.name)) continue;

    const modulePath = pathToFileURL(join(here, entry.name)).href;
    const mod = (await import(modulePath)) as { default?: unknown };

    if (!isCommand(mod.default)) {
      logger.warn({ file: entry.name }, "skipping file with no valid Command default export");
      continue;
    }

    const json = mod.default.data.toJSON();
    commands.set(json.name, mod.default);
  }

  return commands;
}
