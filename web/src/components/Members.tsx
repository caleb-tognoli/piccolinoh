import { presence } from "../store";
import { Panel } from "../ui/Panel";

export function Members() {
  const members = presence.value;
  return (
    <Panel title="Room" count={members.length}>
      <ul class="flex flex-col gap-1">
        {members.map((m) => (
          <li key={m.id} class="truncate py-1 text-sm">
            {m.displayName ?? "Guest"}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
