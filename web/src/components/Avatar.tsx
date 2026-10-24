import { UserRound } from "lucide-preact";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return letters.map((w) => [...w][0]!.toUpperCase()).join("") || "?";
}

/** Same name, same hue, on every screen. */
function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

/** Initials on a colour picked from the name; a person icon for guests. */
export function Avatar({ name }: { name?: string }) {
  if (!name) {
    return (
      <span class="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-muted" aria-hidden="true">
        <UserRound class="size-4" />
      </span>
    );
  }
  const h = hue(name);
  return (
    <span
      class="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
      style={{ background: `hsl(${h} 40% 28%)`, color: `hsl(${h} 85% 85%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
