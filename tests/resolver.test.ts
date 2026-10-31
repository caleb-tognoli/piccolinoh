import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "./helpers.js";

vi.mock("../src/bot/youtube.js", () => ({
  searchVideos: vi.fn(),
  searchSongs: vi.fn(),
  getVideo: vi.fn(),
  getPlaylist: vi.fn(),
  isEmbeddable: vi.fn(),
}));
vi.mock("../src/bot/spotify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bot/spotify.js")>()),
  spotifyEnabled: () => true,
  getTrack: vi.fn(),
  getAlbum: vi.fn(),
}));

const youtube = vi.mocked(await import("../src/bot/youtube.js"));
const spotify = vi.mocked(await import("../src/bot/spotify.js"));
const { rankByDuration, resolveInput } = await import("../src/bot/resolver.js");

beforeEach(() => {
  vi.resetAllMocks();
  youtube.isEmbeddable.mockResolvedValue(true);
});

describe("rankByDuration", () => {
  it("moves tracks within tolerance first and keeps order otherwise", () => {
    const ranked = rankByDuration([track("a", 300), track("b", 200), track("c", 400), track("d", 203)], 201);
    expect(ranked.map((t) => t.videoId)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("resolveInput", () => {
  it("queues the first embeddable search result", async () => {
    youtube.searchVideos.mockResolvedValue([track("blocked"), track("ok"), track("later")]);
    youtube.isEmbeddable.mockImplementation(async (id) => id !== "blocked");
    const result = await resolveInput("some song");
    expect(result).toEqual({ ok: true, tracks: [track("ok")] });
  });

  it("explains when the top results can't be embedded", async () => {
    youtube.searchVideos.mockResolvedValue([track("a"), track("b"), track("c"), track("d")]);
    youtube.isEmbeddable.mockResolvedValue(false);
    expect(await resolveInput("some song")).toMatchObject({ ok: false });
    expect(youtube.isEmbeddable).toHaveBeenCalledTimes(3);
  });

  it("resolves a video link directly", async () => {
    youtube.getVideo.mockResolvedValue({ track: track("dQw4w9WgXcQ"), embeddable: true });
    const result = await resolveInput("https://youtu.be/dQw4w9WgXcQ");
    expect(result).toEqual({ ok: true, tracks: [track("dQw4w9WgXcQ")] });
  });

  it("rejects a video link whose owner disabled embedding", async () => {
    youtube.getVideo.mockResolvedValue({ track: track("dQw4w9WgXcQ"), embeddable: false });
    expect(await resolveInput("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ ok: false });
  });

  it("falls back to search when the video lookup fails", async () => {
    youtube.getVideo.mockRejectedValue(new Error("Sign in to confirm you're not a bot"));
    youtube.searchVideos.mockResolvedValue([track("other"), track("dQw4w9WgXcQ")]);
    const result = await resolveInput("https://youtu.be/dQw4w9WgXcQ");
    expect(result).toEqual({ ok: true, tracks: [track("dQw4w9WgXcQ")] });
  });

  it("queues a playlist link", async () => {
    youtube.getPlaylist.mockResolvedValue({ name: "Mix", tracks: [track("a"), track("b")] });
    const result = await resolveInput("https://www.youtube.com/playlist?list=PL123");
    expect(result).toEqual({ ok: true, tracks: [track("a"), track("b")], playlistName: "Mix" });
  });

  it("rejects links from other sites", async () => {
    expect(await resolveInput("https://soundcloud.com/x/y")).toMatchObject({ ok: false });
  });

  describe("Spotify", () => {
    const link = "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh";

    beforeEach(() => {
      spotify.getTrack.mockResolvedValue({ title: "Song", artist: "Artist", durationSec: 200 });
    });

    it("prefers a YouTube Music song with a matching length, keeping Spotify's names", async () => {
      youtube.searchSongs.mockResolvedValue([track("long", 260), track("match", 202)]);
      const result = await resolveInput(link);
      expect(result).toEqual({
        ok: true,
        tracks: [{ videoId: "match", title: "Song", author: "Artist", durationSec: 202 }],
      });
      expect(youtube.searchSongs).toHaveBeenCalledWith("Artist Song");
      expect(youtube.searchVideos).not.toHaveBeenCalled();
    });

    it("searches regular videos when no song matches the length", async () => {
      youtube.searchSongs.mockResolvedValue([track("song", 260)]);
      youtube.searchVideos.mockResolvedValue([track("video", 199)]);
      const result = await resolveInput(link);
      expect(result).toMatchObject({ ok: true, tracks: [{ videoId: "video", durationSec: 199 }] });
    });

    it("still finds a video when YouTube Music search fails", async () => {
      youtube.searchSongs.mockRejectedValue(new Error("boom"));
      youtube.searchVideos.mockResolvedValue([track("video", 230)]);
      expect(await resolveInput(link)).toMatchObject({ ok: true, tracks: [{ videoId: "video" }] });
    });

    it("rejects playlists", async () => {
      expect(await resolveInput("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toMatchObject({
        ok: false,
      });
    });
  });
});
