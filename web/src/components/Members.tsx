import type { ComponentChildren } from "preact";
import { presence, selfId } from "../store";
import { Avatar } from "./Avatar";

/** Who is watching: a strip of chips under the player. */
export function Members() {
  const members = presence.value;
  const me = members.find((m) => m.id === selfId.value);
  const named = members
    .filter((m) => m !== me && m.displayName)
    .sort((a, b) => a.displayName!.localeCompare(b.displayName!));
  // Guests have nothing to tell them apart, so they share one chip.
  const guests = members.filter((m) => m !== me && !m.displayName).length;

  return (
    <section class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
      <h2 class="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
        Room
        <span class="rounded-full bg-raised px-2 py-0.5 text-[11px] tracking-normal text-ink/80 tabular-nums">
          {members.length}
        </span>
      </h2>
      <ul class="flex min-w-0 flex-wrap gap-1.5">
        {me && (
          <Chip name={me.displayName}>
            {me.displayName ?? "Guest"}
            <span class="ml-1.5 rounded-full bg-accent/15 px-1.5 text-[11px] font-medium text-accent">you</span>
          </Chip>
        )}
        {named.map((m) => (
          <Chip key={m.id} name={m.displayName}>
            {m.displayName}
          </Chip>
        ))}
        {guests > 0 && (
          <Chip>
            <span class="text-muted">
              {guests} {me && !me.displayName ? "more " : ""}
              {guests === 1 ? "guest" : "guests"}
            </span>
          </Chip>
        )}
      </ul>
    </section>
  );
}

function Chip({ name, children }: { name?: string; children: ComponentChildren }) {
  return (
    <li class="flex max-w-full min-w-0 items-center gap-2 rounded-full bg-raised py-0.5 pr-3 pl-0.5 text-sm">
      <Avatar name={name} />
      <span class="flex min-w-0 items-center truncate">{children}</span>
    </li>
  );
}
