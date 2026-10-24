import { cn } from "../ui/cn";

const MASCOT_URL = "/piccolinoh.png";

/** Mascot + wordmark; `large` stacks a big mascot above the name for the join screen. */
export function Logo({ large }: { large?: boolean }) {
  return (
    <span
      class={cn(
        "inline-flex items-center font-semibold tracking-tight",
        large ? "flex-col gap-4 text-3xl" : "gap-2 text-base",
      )}
    >
      <img
        src={MASCOT_URL}
        alt=""
        class={cn(large ? "size-28 rounded-3xl shadow-2xl shadow-black/50" : "size-7 rounded-lg", "ring-1 ring-white/10")}
      />
      piccolinoh
    </span>
  );
}
