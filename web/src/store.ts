import { signal } from "@preact/signals";
import type { WSClient } from "./net";
import type { ControlAction, PresenceMember, SerializedSession } from "./protocol";

export const session = signal<SerializedSession | null>(null);
export const presence = signal<PresenceMember[]>([]);
/** This browser's id in `presence`; changes on every reconnect. */
export const selfId = signal<string | null>(null);
/** serverMs ≈ performance.now() + serverOffset */
export const serverOffset = signal(0);
export const lagging = signal(false);
export interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}
export const toast = signal<Toast | null>(null);
export const wsClient = signal<WSClient | null>(null);
/** False while the socket is down and reconnecting; controls sent then are lost. */
export const connected = signal(true);
/** Shown on the join screen; survives leaving the session view. */
export const joinError = signal<{ message: string; canRetry: boolean } | null>(null);

const THEATER_KEY = "piccolinoh:theater";

function readTheater(): boolean {
  try {
    return localStorage.getItem(THEATER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Wide screens only: player spans the full window width, queue and room move below it. */
export const theater = signal(readTheater());

export function toggleTheater(): void {
  theater.value = !theater.value;
  try {
    localStorage.setItem(THEATER_KEY, theater.value ? "1" : "0");
  } catch {
    // storage blocked (private window); the choice just isn't remembered
  }
}

const VOLUME_KEY = "piccolinoh:volume";

function readVolume(): { level: number; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null") as { level?: unknown; muted?: unknown } | null;
    const level = typeof saved?.level === "number" ? Math.max(0, Math.min(100, Math.round(saved.level))) : 100;
    return { level, muted: saved?.muted === true };
  } catch {
    return { level: 100, muted: false };
  }
}

const savedVolume = readVolume();
/** This browser's volume, 0–100. Local only: the room never sees it. */
export const volume = signal(savedVolume.level);
export const muted = signal(savedVolume.muted);

function saveVolume(): void {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ level: volume.value, muted: muted.value }));
  } catch {
    // storage blocked (private window); the level just isn't remembered
  }
}

/** Raising the level unmutes, like YouTube's own slider. */
export function setVolume(level: number): void {
  volume.value = Math.max(0, Math.min(100, Math.round(level)));
  if (volume.value > 0) muted.value = false;
  saveVolume();
}

export function toggleMute(): void {
  if (muted.value || volume.value === 0) {
    muted.value = false;
    if (volume.value === 0) volume.value = 50;
  } else {
    muted.value = true;
  }
  saveVolume();
}

/** The player's box. Fullscreen targets it rather than the iframe, so the empty stage and toasts come along. */
export const STAGE_ID = "player-stage";

/** False where a plain element can't go fullscreen (iPhone Safari). */
export const canFullscreen = document.fullscreenEnabled;
export const fullscreen = signal(false);
document.addEventListener("fullscreenchange", () => {
  fullscreen.value = document.fullscreenElement?.id === STAGE_ID;
});

export function toggleFullscreen(): void {
  if (!canFullscreen) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  void document.getElementById(STAGE_ID)?.requestFullscreen();
}

export function sendControl(action: ControlAction): void {
  wsClient.value?.send({ type: "control", action });
}

/** Shows `text` in the toast slot; it clears itself after `durationMs` unless replaced first. */
export function showToast(text: string, opts: { action?: Toast["action"]; durationMs?: number } = {}): void {
  const shown: Toast = { text, ...(opts.action ? { action: opts.action } : {}) };
  toast.value = shown;
  if (opts.durationMs != null) {
    window.setTimeout(() => {
      if (toast.value === shown) toast.value = null;
    }, opts.durationMs);
  }
}

/** Clears the toast if it is still showing `text`. */
export function hideToast(text: string): void {
  if (toast.value?.text === text) toast.value = null;
}
