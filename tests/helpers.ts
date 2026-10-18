import type { Track } from "../src/watchtogether/session.js";

export function track(videoId: string, durationSec = 10): Track {
  return { videoId, title: `title ${videoId}`, author: "author", durationSec };
}
