import { config } from "../config.js";

export function buildJoinUrl(sessionId: string): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/#${sessionId}`;
}
