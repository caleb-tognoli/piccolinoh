import { session } from "../store";
import { Controls } from "./Controls";

/** Title and controls for the current video; the empty player explains what to do otherwise. */
export function NowPlaying() {
  const current = session.value?.current;
  if (!current) return null;
  return (
    <section class="rounded-xl border border-line bg-surface p-4">
      <div class="flex flex-col gap-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold tracking-wider text-accent uppercase">Now playing</p>
          <h1 class="mt-1 text-lg leading-snug font-semibold text-balance">{current.title}</h1>
          <p class="text-sm text-muted">{current.author}</p>
        </div>
        <Controls />
      </div>
    </section>
  );
}
