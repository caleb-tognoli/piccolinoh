// Signed tokens embedded in /join links. They carry the user's Discord display
// name to the web client; the server checks the signature before trusting it.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const TTL_MS = 60 * 60 * 1000;

interface Payload {
  sid: string;
  gid: string;
  dn: string;
  exp: number;
}

function sign(payloadB64: string): Buffer {
  return createHmac("sha256", config.JOIN_TOKEN_SECRET).update(payloadB64).digest();
}

export function signJoinToken(input: Omit<Payload, "exp"> & { exp?: number }): string {
  const payload: Payload = { ...input, exp: input.exp ?? Date.now() + TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64).toString("base64url")}`;
}

/** Returns the display name if the token is authentic, unexpired and for this session. */
export function verifyJoinToken(token: string, expected: { sid: string; gid: string }): string | null {
  const [payloadB64, sigB64, ...rest] = token.split(".");
  if (!payloadB64 || !sigB64 || rest.length > 0) return null;

  const expectedSig = sign(payloadB64);
  const providedSig = Buffer.from(sigB64, "base64url");
  if (expectedSig.length !== providedSig.length || !timingSafeEqual(expectedSig, providedSig)) {
    return null;
  }

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  if (payload.sid !== expected.sid || payload.gid !== expected.gid) return null;
  return typeof payload.dn === "string" ? payload.dn : null;
}
