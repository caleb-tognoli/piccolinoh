import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export interface JoinTokenPayload {
  sid: string;
  uid: string;
  dn: string;
  gid: string;
  exp: number;
}

const JOIN_TOKEN_TTL_MS = 60 * 60 * 1000;

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(payloadB64: string): Buffer {
  return createHmac("sha256", config.JOIN_TOKEN_SECRET).update(payloadB64).digest();
}

export function signJoinToken(
  input: Omit<JoinTokenPayload, "exp"> & Partial<Pick<JoinTokenPayload, "exp">>,
): string {
  const payload: JoinTokenPayload = {
    ...input,
    exp: input.exp ?? Date.now() + JOIN_TOKEN_TTL_MS,
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sigB64 = base64UrlEncode(hmac(payloadB64));
  return `${payloadB64}.${sigB64}`;
}

export function verifyJoinToken(
  token: string,
  expected: { sid: string; gid: string },
): JoinTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts as [string, string];

  const expectedSig = hmac(payloadB64);
  const providedSig = base64UrlDecode(sigB64);
  if (expectedSig.length !== providedSig.length) return null;
  if (!timingSafeEqual(expectedSig, providedSig)) return null;

  let payload: JoinTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as JoinTokenPayload;
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  if (payload.sid !== expected.sid || payload.gid !== expected.gid) return null;
  return payload;
}
