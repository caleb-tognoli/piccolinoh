import { describe, expect, it } from "vitest";
import { parseSeek, parseTime } from "../src/bot/time.js";

describe("parseTime", () => {
  it("reads seconds, clock times and unit times", () => {
    expect(parseTime("83")).toBe(83);
    expect(parseTime("1:23")).toBe(83);
    expect(parseTime("1:02:03")).toBe(3723);
    expect(parseTime("90s")).toBe(90);
    expect(parseTime("1m30s")).toBe(90);
    expect(parseTime("1h2m3s")).toBe(3723);
    expect(parseTime(" 2M ")).toBe(120);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "abc", "1:60", "1:61:00", "1:2:3:4", "-5", "1m30", "s"]) {
      expect(parseTime(bad), bad).toBeNull();
    }
  });
});

describe("parseSeek", () => {
  it("is absolute, or relative with a sign, never below zero", () => {
    expect(parseSeek("1:23", 50)).toBe(83);
    expect(parseSeek("+30", 50)).toBe(80);
    expect(parseSeek("-10", 50)).toBe(40);
    expect(parseSeek("-1:00", 50)).toBe(0);
    expect(parseSeek("+x", 50)).toBeNull();
  });
});
