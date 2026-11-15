import { describe, expect, it } from "vitest";
import { seek } from "../src/bot/commands.js";
import { createSession } from "../src/watchtogether/session.js";
import { track } from "./helpers.js";

describe("/seek", () => {
  it("explains what's wrong instead of seeking", () => {
    const session = createSession("g");
    expect(seek(session, "1:00", {})).toBe("Nothing playing to seek in.");
    session.current = { ...track("a", 120), startedAtServerMs: Date.now(), pausedAtPositionSec: 10 };
    expect(seek(session, "soon", {})).toMatch(/^Use a time like/);
    expect(seek(session, "3:00", {})).toBe("That's past the end (2:00).");
  });

  it("jumps to absolute and relative times", () => {
    const session = createSession("g");
    session.current = { ...track("a", 120), startedAtServerMs: Date.now(), pausedAtPositionSec: 10 };
    expect(seek(session, "+30", { by: "Bob" })).toEqual({ kind: "seek", title: "title a", toSec: 40, by: "Bob" });
    expect(session.current.pausedAtPositionSec).toBe(40);
    seek(session, "1:23", {});
    expect(session.current.pausedAtPositionSec).toBe(83);
  });
});
