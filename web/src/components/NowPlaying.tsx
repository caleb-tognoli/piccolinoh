import { session } from "../store";
import { AutoplayStatus, TheaterToggle, Transport } from "./Controls";
import { Progress } from "./Progress";

/**
 * Title and controls for the current video; the empty player explains what to do otherwise.
 * Phones stack title, timeline and buttons. Wide screens fold them into one compact bar
 * (timeline over buttons · title · status), so a taller player still leaves it on screen.
 */
export function NowPlaying() {
  const current = session.value?.current;
  if (!current) return null;
  return (
    <section class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-3 rounded-xl border border-line bg-surface p-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-y-1 lg:py-3">
      <div class="col-span-full min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:px-2">
        <p class="text-xs font-semibold tracking-wider text-accent uppercase lg:hidden">Now playing</p>
        <h1
          class="mt-1 text-lg leading-snug font-semibold text-balance lg:mt-0 lg:truncate lg:text-base"
          title={current.title}
        >
          {current.title}
        </h1>
        <p class="truncate text-sm text-muted">{current.author}</p>
      </div>
      <div class="col-span-full lg:row-start-1">
        <Progress track={current} />
      </div>
      <Transport class="lg:col-start-1 lg:row-start-2" />
      <div class="flex min-w-0 items-center justify-end gap-1 lg:col-start-3 lg:row-start-2">
        <AutoplayStatus />
        {/* Wrapped: the button's own display class would win over `hidden`. */}
        <span class="hidden lg:contents">
          <TheaterToggle />
        </span>
      </div>
    </section>
  );
}
