import { session } from "../store";
import { cn } from "../ui/cn";
import { AutoplayStatus, FullscreenToggle, TheaterToggle, Transport, VolumeControl } from "./Controls";
import { Progress, TimeReadout } from "./Progress";

/**
 * Title, timeline and controls for the current video, laid out like YouTube's player bar:
 * title on top, a full-width timeline, then one row of buttons with the clock inline.
 * `overlay`: the same card drawn over the video in fullscreen, without its own background
 * (the stage puts a gradient behind it). The empty player explains what to do otherwise.
 */
export function NowPlaying({ overlay = false }: { overlay?: boolean }) {
  const current = session.value?.current;
  if (!current) return null;
  // The card under the player stays in the page while fullscreen draws its copy; one heading is enough.
  const Title = overlay ? "p" : "h1";
  return (
    <section class={cn("flex flex-col gap-3", !overlay && "rounded-xl border border-line bg-surface p-4")}>
      <div class="min-w-0">
        <Title class="line-clamp-2 text-lg leading-snug font-semibold text-balance" title={current.title}>
          {current.title}
        </Title>
        {/* The autoplay pill sits here rather than in the button row, which has no room for it on phones. */}
        <div class="flex min-w-0 items-center gap-2">
          <p class="min-w-0 truncate text-sm text-muted">
            {current.author}
            {current.addedBy ? ` · added by ${current.addedBy.name}` : ""}
          </p>
          <span class="ml-auto shrink-0">
            <AutoplayStatus />
          </span>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <Progress track={current} />
        <div class="flex min-w-0 items-center gap-1">
          <Transport />
          <VolumeControl />
          <TimeReadout track={current} />
          <div class="ml-auto flex items-center justify-end gap-1">
            {/* Wrapped: the button's own display class would win over `hidden`. Theater mode is a wide-window layout. */}
            {!overlay && (
              <span class="hidden lg:contents">
                <TheaterToggle />
              </span>
            )}
            <FullscreenToggle />
          </div>
        </div>
      </div>
    </section>
  );
}
