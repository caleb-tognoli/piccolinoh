import type { ComponentChildren } from "preact";
import { presence, selfId } from "../store";
import { Panel } from "../ui/Panel";
import { Avatar } from "./Avatar";

export function Members() {
  const members = presence.value;
  const me = members.find((m) => m.id === selfId.value);
  const named = members
    .filter((m) => m !== me && m.displayName)
    .sort((a, b) => a.displayName!.localeCompare(b.displayName!));
  // Guests have nothing to tell them apart, so they share one row.
  const guests = members.filter((m) => m !== me && !m.displayName).length;

  return (
    <Panel title="Room" count={members.length}>
      <ul class="flex flex-col gap-1">
        {me && (
          <Row name={me.displayName}>
            {me.displayName ?? "Guest"}
            <span class="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">you</span>
          </Row>
        )}
        {named.map((m) => (
          <Row key={m.id} name={m.displayName}>
            {m.displayName}
          </Row>
        ))}
        {guests > 0 && (
          <Row>
            <span class="text-muted">
              {guests} {me && !me.displayName ? "more " : ""}
              {guests === 1 ? "guest" : "guests"}
            </span>
          </Row>
        )}
      </ul>
    </Panel>
  );
}

function Row({ name, children }: { name?: string; children: ComponentChildren }) {
  return (
    <li class="flex min-w-0 items-center gap-2.5 py-1 text-sm">
      <Avatar name={name} />
      <span class="flex min-w-0 items-center truncate">{children}</span>
    </li>
  );
}
