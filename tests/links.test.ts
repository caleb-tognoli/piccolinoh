import { describe, expect, it } from "vitest";
import { parseYouTubeUrl } from "../src/bot/resolver.js";
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

describe("parseYouTubeUrl", () => {
  const video = (id: string) => ({ kind: "video", id });

  it("recognizes single-video links", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual(video("dQw4w9WgXcQ"));
    expect(parseYouTubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual(video("dQw4w9WgXcQ"));
    expect(parseYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual(video("dQw4w9WgXcQ"));
  });

  it("reads a link's start time", () => {
    const at = (startSec: number) => ({ kind: "video", id: "dQw4w9WgXcQ", startSec });
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=42")).toEqual(at(42));
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?si=x&t=1m30s")).toEqual(at(90));
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s")).toEqual(at(90));
    expect(parseYouTubeUrl("https://www.youtube.com/embed/x?start=5&v=dQw4w9WgXcQ")).toEqual(at(5));
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=2m")).toEqual(at(120));
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=0")).toEqual(video("dQw4w9WgXcQ"));
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=soon")).toEqual(video("dQw4w9WgXcQ"));
  });

  it("prefers the video when a watch link also has a list", () => {
    expect(parseYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123")).toEqual(video("dQw4w9WgXcQ"));
  });

  it("recognizes playlist links", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/playlist?list=PL123")).toEqual({ kind: "playlist", id: "PL123" });
  });

  it("returns null for other sites and plain text", () => {
    expect(parseYouTubeUrl("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/@somechannel")).toBeNull();
    expect(parseYouTubeUrl("never gonna give you up")).toBeNull();
  });
});
