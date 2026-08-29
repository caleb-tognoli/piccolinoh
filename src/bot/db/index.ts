import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { logger } from "../../logger.js";
import { SCHEMA_SQL } from "./schema.js";

let db: DatabaseSync | null = null;

export function openDb(path: string): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  logger.info({ path }, "sqlite: opened");
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error("db not opened — call openDb(path) first");
  return db;
}
