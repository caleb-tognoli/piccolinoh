/** 75 -> "1:15", 3716 -> "1:01:56" */
export function formatSec(n: number): string {
  const total = Math.max(0, Math.floor(n));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "90", "1:30", "1:01:30" -> seconds */
export function parseTime(input: string): number | null {
  if (!input.trim()) return null;
  const parts = input.trim().split(":").map(Number);
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
