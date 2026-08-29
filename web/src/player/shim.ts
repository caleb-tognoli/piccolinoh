import { effect } from "@preact/signals";
import { serverNow } from "../net/clockSync";
import type { SerializedSession } from "../net/protocol";
import type { WSClient } from "../net/ws";
import { lagging, session, toast } from "../state/store";

const IFRAME_API_URL = "https://www.youtube.com/iframe_api";
const SYNC_INTERVAL_MS = 2000;
const DEAD_ZONE_SEC = 2.0;
const RECONCILE_GRACE_MS = 1000;
const STALL_THRESHOLD_MS = 5000;
const RECONCILE_TOAST_MS = 4000;

let apiReadyPromise: Promise<void> | null = null;

function ensureIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise<void>((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement("script");
    script.src = IFRAME_API_URL;
    script.async = true;
    document.head.appendChild(script);
  });
  return apiReadyPromise;
}

function derivedPosition(s: SerializedSession | null): number {
  if (!s?.current) return 0;
  if (s.current.pausedAtPositionSec != null) return s.current.pausedAtPositionSec;
  return (serverNow() - s.current.startedAtServerMs) / 1000;
}

export async function attachPlayer(containerId: string, ws: WSClient): Promise<() => void> {
  await ensureIframeApi();

  let player: YT.Player | null = null;
  let lastEpoch = -1;
  let lastVideoId: string | null = null;
  let lastPaused = false;
  let lastActualTime = 0;
  let lastActualUpdateAt = performance.now();
  let reconcileTimer: number | null = null;

  const readyPromise = new Promise<void>((resolveReady) => {
    player = new window.YT!.Player(containerId, {
      height: "100%",
      width: "100%",
      playerVars: { controls: 1, playsinline: 1, autoplay: 0 },
      events: {
        onReady: () => resolveReady(),
        onStateChange: (ev) => onStateChange(ev.data),
        onError: (ev) => onError(ev.data),
      },
    });
  });

  await readyPromise;

  function applyServerState(): void {
    if (!player) return;
    const s = session.value;
    if (!s) return;
    if (s.epoch < lastEpoch) return;
    const epochBumped = s.epoch > lastEpoch;
    lastEpoch = s.epoch;

    const videoId = s.current?.videoId ?? null;
    const paused = s.current?.pausedAtPositionSec != null;

    if (videoId !== lastVideoId) {
      lastVideoId = videoId;
      lastPaused = paused;
      if (videoId) {
        player.loadVideoById({ videoId, startSeconds: derivedPosition(s) });
      } else {
        player.stopVideo();
      }
      return;
    }

    if (!videoId) return;

    if (paused !== lastPaused) {
      lastPaused = paused;
      if (paused) {
        player.pauseVideo();
      } else {
        player.seekTo(derivedPosition(s), true);
        player.playVideo();
      }
      return;
    }

    // Same video, same paused state — only seek in response to a real
    // server-side epoch bump (e.g. a /seek control). For no-op session
    // reference changes (queueUpdate merges, presence-driven re-renders),
    // leave drift correction to the 2 s sync loop.
    if (!epochBumped) return;
    const expected = derivedPosition(s);
    const actual = player.getCurrentTime();
    if (Math.abs(expected - actual) > DEAD_ZONE_SEC) {
      player.seekTo(expected, true);
    }
  }

  function onStateChange(state: number): void {
    if (!player) return;
    const s = session.value;
    if (!s?.current) return;

    const serverPlaying = s.current.pausedAtPositionSec == null;
    const localPlaying = state === 1;
    const localPaused = state === 2;

    const matches = (serverPlaying && localPlaying) || (!serverPlaying && localPaused);
    if (matches) {
      if (reconcileTimer != null) {
        window.clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      return;
    }

    if (reconcileTimer != null) return;
    reconcileTimer = window.setTimeout(() => {
      reconcileTimer = null;
      const cur = session.value?.current;
      if (!cur || !player) return;
      player.seekTo(derivedPosition(session.value), true);
      if (cur.pausedAtPositionSec == null) player.playVideo();
      else player.pauseVideo();
      toast.value =
        "controls are shared — use the buttons below, or leave the session to watch freely";
      window.setTimeout(() => {
        if (toast.value?.startsWith("controls")) toast.value = null;
      }, RECONCILE_TOAST_MS);
    }, RECONCILE_GRACE_MS);
  }

  function onError(code: number): void {
    const s = session.value;
    if (!s?.current) return;
    if (code === 101 || code === 150) {
      ws.send({ type: "playbackError", videoId: s.current.videoId, code });
    } else {
      console.warn("youtube player error", code);
    }
  }

  const unsubSession = effect(() => {
    // Subscribe to session changes.
    session.value;
    applyServerState();
  });

  const syncTimer = window.setInterval(() => {
    if (!player) return;
    const s = session.value;
    if (!s?.current) return;

    const state = player.getPlayerState();
    const actual = player.getCurrentTime();

    if (actual !== lastActualTime) {
      lastActualTime = actual;
      lastActualUpdateAt = performance.now();
      if (lagging.value) {
        lagging.value = false;
        if (toast.value === "catching up to the room…") toast.value = null;
        const expected = derivedPosition(s);
        if (Math.abs(expected - actual) > DEAD_ZONE_SEC) {
          player.seekTo(expected, true);
        }
      }
    } else if ((state === 1 || state === 3) && performance.now() - lastActualUpdateAt > STALL_THRESHOLD_MS) {
      if (!lagging.value) {
        lagging.value = true;
        toast.value = "catching up to the room…";
      }
      return;
    }

    if (state !== 1 || lagging.value) return;

    const expected = derivedPosition(s);
    if (Math.abs(expected - actual) > DEAD_ZONE_SEC) {
      player.seekTo(expected, true);
    }
  }, SYNC_INTERVAL_MS);

  return () => {
    window.clearInterval(syncTimer);
    if (reconcileTimer != null) window.clearTimeout(reconcileTimer);
    unsubSession();
    player?.destroy();
    player = null;
  };
}
