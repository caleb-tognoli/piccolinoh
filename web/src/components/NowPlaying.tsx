import { session } from "../store";
import { AutoplayStatus, FullscreenToggle, TheaterToggle, Transport, VolumeControl } from "./Controls";
import { Progress } from "./Progress";

/**
 * Title and controls for the current video; the empty player explains what to do otherwise.
 * A narrow bar stacks title, timeline and buttons, so the title always gets a line of its own.
 * A wide one folds them into one compact row (timeline over buttons · title · status), so a
 * taller player still leaves it on screen. The bar's own width decides, not the window's:
 * the player (and so the bar) is narrow on small desktop windows too.
 */
export function NowPlaying() {
  const current = session.value?.current;
  if (!current) return null;
  return (
    <div class="@container">
      <section class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-3 rounded-xl border border-line bg-surface p-4 @3xl:grid-cols-[auto_minmax(0,1fr)_auto] @3xl:gap-y-1 @3xl:py-3">
        <div class="col-span-full min-w-0 @3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-2 @3xl:px-2">
          <p class="text-xs font-semibold tracking-wider text-accent uppercase @3xl:hidden">Now playing</p>
          <h1
            class="mt-1 text-lg leading-snug font-semibold text-balance @3xl:mt-0 @3xl:truncate @3xl:text-base"
            title={current.title}
          >
            {current.title}
          </h1>
          <p class="truncate text-sm text-muted">{current.author}</p>
        </div>
        <div class="col-span-full @3xl:row-start-1">
          <Progress track={current} />
        </div>
        <Transport class="@3xl:col-start-1 @3xl:row-start-2" />
        <div class="flex min-w-0 items-center justify-end gap-1 @3xl:col-start-3 @3xl:row-start-2">
          <AutoplayStatus />
          <VolumeControl />
          {/* Wrapped: the button's own display class would win over `hidden`. Theater mode is a wide-window layout. */}
          <span class="hidden lg:contents">
            <TheaterToggle />
          </span>
          <FullscreenToggle />
        </div>
      </section>
    </div>
  );
}
