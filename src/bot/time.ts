// Times typed by people or carried in links: "83", "1:23", "1:02:03", "1m30s".

/** Seconds for a time like "83", "1:23", "1:02:03", "90s" or "1h2m3s"; null if it isn't one. */
export function parseTime(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);

  const clock = /^(?:(\d+):)?(\d+):(\d{1,2})$/.exec(text);
  if (clock) {
    const [, h = "0", m, s] = clock;
    if (Number(s) >= 60 || (clock[1] !== undefined && Number(m) >= 60)) return null;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (units && text !== "") {
    const [, h = "0", m = "0", s = "0"] = units;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  return null;
}

/** Where a /seek lands: an absolute time, or "+30" / "-10" relative to `positionSec`. */
export function parseSeek(input: string, positionSec: number): number | null {
  const text = input.trim();
  const sign = text.startsWith("+") ? 1 : text.startsWith("-") ? -1 : 0;
  const sec = parseTime(sign ? text.slice(1) : text);
  if (sec === null) return null;
  return sign ? Math.max(0, positionSec + sign * sec) : sec;
}
