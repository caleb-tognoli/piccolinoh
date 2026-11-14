import { describe, expect, it } from "vitest";
import { baseTitle, parsePlays } from "../src/bot/youtube.js";

describe("parsePlays", () => {
  it("reads YouTube Music play counts", () => {
    expect(parsePlays("Opalite Taylor Swift 290M plays")).toBe(290e6);
    expect(parsePlays("4.5B plays")).toBe(4.5e9);
    expect(parsePlays("12K plays")).toBe(12e3);
    expect(parsePlays("1,234 plays")).toBe(1234);
  });

  it("returns 0 when there is no count", () => {
    expect(parsePlays(undefined)).toBe(0);
    expect(parsePlays("Lontano N/A")).toBe(0);
  });
});

describe("baseTitle", () => {
  it("drops version suffixes", () => {
    expect(baseTitle("Patient Zero (Piano Version)")).toBe("patient zero");
    expect(baseTitle("Patient Zero [Acoustic]")).toBe("patient zero");
    expect(baseTitle("Patient Zero - Live")).toBe("patient zero");
    expect(baseTitle("Patient Zero")).toBe("patient zero");
  });

  it("keeps a title that is only a bracket", () => {
    expect(baseTitle("(Intro)")).toBe("(intro)");
  });
});
