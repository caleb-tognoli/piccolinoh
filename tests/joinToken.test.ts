import { describe, expect, it } from "vitest";
import { signJoinToken, verifyJoinToken } from "../src/joinToken.js";

const base = { sid: "session-123", gid: "guild-42", dn: "Alice ✨" };
const expected = { sid: base.sid, gid: base.gid };

// Flips the first character: base64url's last character can carry padding bits
// that decode to the same bytes, so changing it doesn't always tamper.
function flipFirstChar(s: string): string {
  return (s[0] === "A" ? "B" : "A") + s.slice(1);
}

describe("joinToken", () => {
  it("verifies a freshly signed token and returns the display name", () => {
    expect(verifyJoinToken(signJoinToken(base), expected)).toBe("Alice ✨");
  });

  it("rejects a tampered payload or signature", () => {
    const [payload, sig] = signJoinToken(base).split(".") as [string, string];
    expect(verifyJoinToken(`${flipFirstChar(payload)}.${sig}`, expected)).toBeNull();
    expect(verifyJoinToken(`${payload}.${flipFirstChar(sig)}`, expected)).toBeNull();
    expect(verifyJoinToken("garbage", expected)).toBeNull();
  });

  it("rejects a token for another session or guild", () => {
    const token = signJoinToken(base);
    expect(verifyJoinToken(token, { sid: "other", gid: base.gid })).toBeNull();
    expect(verifyJoinToken(token, { sid: base.sid, gid: "other" })).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifyJoinToken(signJoinToken({ ...base, exp: Date.now() - 1_000 }), expected)).toBeNull();
  });
});
