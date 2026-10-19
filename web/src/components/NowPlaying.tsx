import { session } from "../store";
import { Controls } from "./Controls";

export function NowPlaying() {
  const current = session.value?.current;
  return (
    <section class="rounded-xl border border-line bg-surface p-4">
      {current ? (
        <div class="flex flex-col gap-4">
          <div class="min-w-0">
            <p class="text-xs font-semibold tracking-wider text-accent uppercase">Now playing</p>
            <h1 class="mt-1 text-lg leading-snug font-semibold text-balance">{current.title}</h1>
            <p class="text-sm text-muted">{current.author}</p>
          </div>
          <Controls />
        </div>
      ) : (
        <div>
          <h1 class="font-semibold">Nothing playing</h1>
          <p class="text-sm text-muted">
            Queue something with <code class="rounded bg-raised px-1.5 py-0.5 text-ink">/play</code> in Discord.
          </p>
        </div>
      )}
    </section>
  );
}
