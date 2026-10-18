import { describe, expect, it } from "vitest";
import { youtubeVideoId } from "../src/bot/resolver.js";
import { parseSpotifyUrl } from "../src/bot/spotify.js";

describe("parseSpotifyUrl", () => {
  it("parses https track URLs", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh")).toEqual({
      kind: "track",
      id: "4iV5W9uYEdYUVa79Axb7Rh",
    });
  });

  it("parses https album URLs with query strings", () => {
    expect(
      parseSpotifyUrl("https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa?si=abc"),
    ).toEqual({ kind: "album", id: "4m2880jivSbbyEGAKfITCa" });
  });

  it("parses intl-<lang> path prefix", () => {
    expect(
      parseSpotifyUrl("https://open.spotify.com/intl-it/track/4iV5W9uYEdYUVa79Axb7Rh"),
    ).toEqual({ kind: "track", id: "4iV5W9uYEdYUVa79Axb7Rh" });
  });

  it("parses spotify: URIs", () => {
    expect(parseSpotifyUrl("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M")).toEqual({
      kind: "playlist",
      id: "37i9dQZF1DXcBWIGoYBM5M",
    });
  });

  it("returns null for non-Spotify URLs", () => {
    expect(parseSpotifyUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseSpotifyUrl("hello world")).toBeNull();
    expect(parseSpotifyUrl("spotify:something:invalid")).toBeNull();
  });

  it("returns null for malformed Spotify IDs", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/track/short")).toBeNull();
  });
});

describe("youtubeVideoId", () => {
  it("extracts ids from single-video links", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for playlists, other sites and plain text", () => {
    expect(youtubeVideoId("https://www.youtube.com/playlist?list=PL123")).toBeNull();
    expect(youtubeVideoId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeVideoId("never gonna give you up")).toBeNull();
  });
});
