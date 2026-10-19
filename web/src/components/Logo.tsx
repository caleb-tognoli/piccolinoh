import { Play } from "lucide-preact";
import { cn } from "../ui/cn";

export function Logo({ large }: { large?: boolean }) {
  return (
    <span class={cn("inline-flex items-center font-semibold tracking-tight", large ? "gap-3 text-3xl" : "gap-2 text-base")}>
      <span
        class={cn(
          "grid place-items-center rounded-lg bg-accent text-accent-ink",
          large ? "size-11 rounded-xl" : "size-7",
        )}
      >
        <Play class={large ? "size-5" : "size-3.5"} fill="currentColor" strokeWidth={0} />
      </span>
      piccolinoh
    </span>
  );
}
