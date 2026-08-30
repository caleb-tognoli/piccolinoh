import { describe, expect, it } from "vitest";
import { signJoinToken, verifyJoinToken } from "../src/bot/joinToken.js";

const base = { sid: "session-123", uid: "user-1", dn: "Alice", gid: "guild-42" };

describe("joinToken", () => {
  it("verifies a freshly signed token", () => {
    const token = signJoinToken(base);
    const payload = verifyJoinToken(token, { sid: base.sid, gid: base.gid });
    expect(payload).not.toBeNull();
    expect(payload?.dn).toBe("Alice");
    expect(payload?.uid).toBe("user-1");
  });

  it("rejects a token whose payload has been tampered", () => {
    const token = signJoinToken(base);
    const [payload, sig] = token.split(".");
    // Flip a bit in the payload — signature no longer matches.
    const tampered = payload!.slice(0, -1) + (payload!.at(-1) === "A" ? "B" : "A") + "." + sig;
    expect(verifyJoinToken(tampered, { sid: base.sid, gid: base.gid })).toBeNull();
  });

  it("rejects a token whose signature has been tampered", () => {
    const token = signJoinToken(base);
    const [payload, sig] = token.split(".");
    const flipped = sig!.slice(0, -1) + (sig!.at(-1) === "A" ? "B" : "A");
    expect(verifyJoinToken(payload + "." + flipped, { sid: base.sid, gid: base.gid })).toBeNull();
  });

  it("rejects a token whose sid or gid does not match", () => {
    const token = signJoinToken(base);
    expect(verifyJoinToken(token, { sid: "other", gid: base.gid })).toBeNull();
    expect(verifyJoinToken(token, { sid: base.sid, gid: "other" })).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signJoinToken({ ...base, exp: Date.now() - 1_000 });
    expect(verifyJoinToken(token, { sid: base.sid, gid: base.gid })).toBeNull();
  });
});
