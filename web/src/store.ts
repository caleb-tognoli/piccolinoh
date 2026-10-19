import { signal } from "@preact/signals";
import type { WSClient } from "./net";
import type { ControlAction, PresenceMember, SerializedSession } from "./protocol";

export const session = signal<SerializedSession | null>(null);
export const presence = signal<PresenceMember[]>([]);
/** serverMs ≈ performance.now() + serverOffset */
export const serverOffset = signal(0);
export const lagging = signal(false);
export const toast = signal<string | null>(null);
export const wsClient = signal<WSClient | null>(null);
/** Shown on the join screen; survives leaving the session view. */
export const joinError = signal<{ message: string; canRetry: boolean } | null>(null);

export function sendControl(action: ControlAction): void {
  wsClient.value?.send({ type: "control", action });
}
