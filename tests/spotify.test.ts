import { afterEach, describe, expect, it, vi } from "vitest";
import { ALBUM_TRACK_CAP, getAlbum } from "../src/bot/spotify.js";

const apiTrack = (n: number) => ({ id: `t${n}`, name: `Song ${n}`, artists: [{ name: "A" }], duration_ms: 200_000 });
const page = (from: number, count: number, total: number) => ({
  items: Array.from({ length: count }, (_, i) => apiTrack(from + i)),
  next: from + count < total ? "more" : null,
  total,
});

afterEach(() => vi.unstubAllGlobals());

function stubSpotify(total: number) {
  const fetch = vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("/api/token")) return json({ access_token: "x", expires_in: 3600 });
    const offset = /offset=(\d+)/.exec(url);
    if (offset) return json(page(Number(offset[1]), Math.min(50, total - Number(offset[1])), total));
    return json({ name: "Box Set", tracks: page(0, Math.min(50, total), total) });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("getAlbum", () => {
  it("pages past the first 50 tracks", async () => {
    stubSpotify(120);
    const album = await getAlbum("id");
    expect(album?.tracks).toHaveLength(120);
    expect(album?.tracks[119]?.title).toBe("Song 119");
    expect(album?.total).toBe(120);
  });

  it("stops at the cap but reports the album's size", async () => {
    const fetch = stubSpotify(700);
    const album = await getAlbum("id");
    expect(album?.tracks).toHaveLength(ALBUM_TRACK_CAP);
    expect(album?.total).toBe(700);
    expect(fetch.mock.calls.filter(([url]) => url.includes("offset=")).length).toBe(ALBUM_TRACK_CAP / 50 - 1);
  });
});
