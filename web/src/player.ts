import { effect } from "@preact/signals";
import { trackPosition, type WSClient } from "./net";
import type { SerializedSession } from "./protocol";
import { hideToast, lagging, muted, playerVolume, session, showToast, volume } from "./store";

const IFRAME_API_URL = "https://www.youtube.com/iframe_api";
const SYNC_INTERVAL_MS = 2000;
/** Further off than this, jump straight to the room's position. */
const SEEK_THRESHOLD_SEC = 2.0;
/** Closer than SEEK_THRESHOLD_SEC but further than this, drift back by playing a little fast or slow. */
const NUDGE_START_SEC = 0.3;
const NUDGE_STOP_SEC = 0.1;
const NUDGE_RATE_DELTA = 0.05;
const NUDGE_CHECK_MS = 250;
const RECONCILE_GRACE_MS = 1000;
const STALL_THRESHOLD_MS = 5000;
const RECONCILE_TOAST_MS = 4000;
const RECONCILE_TOAST = "Controls are shared. Use the buttons below, or leave the session to watch on your own.";
const CATCHING_UP_TOAST = "Catching up to the room…";
// YT.PlayerState values
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

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
  return s?.current ? trackPosition(s.current) : 0;
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
  /** 0 at normal speed, else +1 / -1 while playing fast / slow to close a small drift. */
  let nudge: 0 | 1 | -1 = 0;
  let nudgeTimer: number | null = null;
  /** Some videos only offer YouTube's 0.25 steps; then small drift is left alone, as before. */
  let canNudge = true;

  const readyPromise = new Promise<void>((resolveReady) => {
    player = new window.YT!.Player(containerId, {
      height: "100%",
      width: "100%",
      // The frame is display-only: playback changes made inside it never reach the server,
      // so everyone drives the room from our own controls instead.
      playerVars: { controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, autoplay: 0 },
      events: {
        onReady: (ev) => {
          const iframe = ev.target.getIframe();
          iframe.tabIndex = -1;
          iframe.setAttribute("aria-hidden", "true");
          resolveReady();
        },
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
      stopNudge();
      canNudge = true;
      if (videoId) {
        // loadVideoById autoplays, so a paused room only cues the track.
        if (paused) player.cueVideoById({ videoId, startSeconds: derivedPosition(s) });
        else player.loadVideoById({ videoId, startSeconds: derivedPosition(s) });
      } else {
        player.stopVideo();
      }
      return;
    }

    if (!videoId) return;

    if (paused !== lastPaused) {
      lastPaused = paused;
      stopNudge();
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
    // reference changes (queue edits, presence-driven re-renders),
    // leave drift correction to the 2 s sync loop.
    if (!epochBumped) return;
    const expected = derivedPosition(s);
    const actual = player.getCurrentTime();
    if (Math.abs(expected - actual) > SEEK_THRESHOLD_SEC) {
      stopNudge();
      player.seekTo(expected, true);
    }
  }

  function stopNudge(): void {
    if (nudgeTimer != null) {
      window.clearTimeout(nudgeTimer);
      nudgeTimer = null;
    }
    if (nudge === 0) return;
    nudge = 0;
    player?.setPlaybackRate(1);
  }

  /**
   * Brings a playing video back to the room's position: a seek for big gaps, otherwise a
   * few seconds at 0.95x or 1.05x (YouTube keeps the pitch), which is smoother than a jump.
   */
  function correctDrift(): void {
    if (!player) return;
    const s = session.value;
    if (!s?.current || player.getPlayerState() !== PLAYING || lagging.value) {
      stopNudge();
      return;
    }
    if (nudge !== 0 && player.getPlaybackRate() === 1) {
      // The player rounded our rate back to 1x: this video can't be nudged.
      canNudge = false;
      nudge = 0;
    }
    const drift = player.getCurrentTime() - derivedPosition(s); // > 0: ahead of the room
    const off = Math.abs(drift);
    if (off > SEEK_THRESHOLD_SEC) {
      stopNudge();
      player.seekTo(derivedPosition(s), true);
      return;
    }
    const direction = drift > 0 ? -1 : 1;
    if (nudge === 0) {
      if (off <= NUDGE_START_SEC || !canNudge) return;
      nudge = direction;
      player.setPlaybackRate(1 + direction * NUDGE_RATE_DELTA);
    } else if (off <= NUDGE_STOP_SEC || direction !== nudge) {
      stopNudge();
      return;
    }
    // Check often while nudging so we stop on target instead of overshooting.
    if (nudgeTimer != null) window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => {
      nudgeTimer = null;
      correctDrift();
    }, NUDGE_CHECK_MS);
  }

  /**
   * True only when the frame is settled in the opposite play state to the room, which is what
   * a click on the video does. Loading, buffering, cued and ended are the player's own
   * transitions (every track change passes through them), not someone taking control.
   */
  function divergesFromRoom(state: number): boolean {
    const cur = session.value?.current;
    if (!cur) return false;
    const serverPlaying = cur.pausedAtPositionSec == null;
    return (serverPlaying && state === PAUSED) || (!serverPlaying && state === PLAYING);
  }

  function onStateChange(state: number): void {
    if (!player) return;
    if (state !== PLAYING && state !== PAUSED) return;

    if (!divergesFromRoom(state)) {
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
      // The room may have caught up (or a new track started loading) during the grace period.
      if (!divergesFromRoom(player.getPlayerState())) return;
      stopNudge();
      player.seekTo(derivedPosition(session.value), true);
      if (cur.pausedAtPositionSec == null) player.playVideo();
      else player.pauseVideo();
      showToast(RECONCILE_TOAST, { durationMs: RECONCILE_TOAST_MS });
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

  const unsubVolume = effect(() => {
    const level = playerVolume(volume.value);
    // YouTube's setVolume(0) isn't reliably silent, so a zero level mutes as well.
    const silent = muted.value || level === 0;
    if (!player) return;
    player.setVolume(level);
    if (silent) player.mute();
    else player.unMute();
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
        hideToast(CATCHING_UP_TOAST);
        const expected = derivedPosition(s);
        if (Math.abs(expected - actual) > SEEK_THRESHOLD_SEC) {
          player.seekTo(expected, true);
        }
      }
    } else if ((state === PLAYING || state === BUFFERING) && performance.now() - lastActualUpdateAt > STALL_THRESHOLD_MS) {
      if (!lagging.value) {
        lagging.value = true;
        showToast(CATCHING_UP_TOAST);
      }
      stopNudge();
      return;
    }

    // While nudging, correctDrift is already checking on its own faster timer.
    if (nudgeTimer == null) correctDrift();
  }, SYNC_INTERVAL_MS);

  return () => {
    window.clearInterval(syncTimer);
    if (reconcileTimer != null) window.clearTimeout(reconcileTimer);
    if (nudgeTimer != null) window.clearTimeout(nudgeTimer);
    unsubSession();
    unsubVolume();
    player?.destroy();
    player = null;
  };
}
