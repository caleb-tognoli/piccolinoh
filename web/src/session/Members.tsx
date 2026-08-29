import { presence } from "../state/store";

export function Members() {
  const members = presence.value;
  return (
    <div class="members">
      <h3>Room ({members.length})</h3>
      <ul>
        {members.map((m) => (
          <li>{m.displayName ?? "Guest"}</li>
        ))}
      </ul>
    </div>
  );
}
