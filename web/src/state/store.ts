import { signal } from "@preact/signals";
import type { PresenceMember, SerializedSession } from "../net/protocol";
import type { WSClient } from "../net/ws";

export const phase = signal<"join" | "session">("join");
export const session = signal<SerializedSession | null>(null);
export const serverOffset = signal<number>(0);
export const presence = signal<PresenceMember[]>([]);
export const lagging = signal<boolean>(false);
export const toast = signal<string | null>(null);
export const displayName = signal<string>("Guest");
export const wsClient = signal<WSClient | null>(null);
