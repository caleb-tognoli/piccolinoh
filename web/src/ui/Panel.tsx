import type { ComponentChildren } from "preact";
import { cn } from "./cn";

export function Panel({
  title,
  count,
  meta,
  class: className,
  children,
}: {
  title: string;
  count?: number;
  /** Shown at the right end of the header. */
  meta?: ComponentChildren;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <section class={cn("rounded-xl border border-line bg-surface p-4", className)}>
      <h2 class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
        {title}
        {count != null && (
          <span class="rounded-full bg-raised px-2 py-0.5 text-[11px] tracking-normal text-ink/80 tabular-nums">
            {count}
          </span>
        )}
        {meta != null && <span class="ml-auto text-xs font-normal tracking-normal normal-case tabular-nums">{meta}</span>}
      </h2>
      {children}
    </section>
  );
}
