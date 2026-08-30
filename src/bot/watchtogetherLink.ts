import { config } from "../config.js";
import { signJoinToken, type JoinTokenPayload } from "./joinToken.js";

export function buildJoinUrl(sessionId: string): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/#${sessionId}`;
}

export function buildSignedJoinUrl(
  payload: Omit<JoinTokenPayload, "exp"> & Partial<Pick<JoinTokenPayload, "exp">>,
): string {
  const token = signJoinToken(payload);
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/#${payload.sid}&t=${token}`;
}
