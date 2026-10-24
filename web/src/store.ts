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
