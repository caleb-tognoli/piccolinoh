import { WifiOff } from "lucide-preact";
import { connected } from "../store";

/** Shown while the socket reconnects. Fades in after a moment so quick blips don't flash it. */
export function ConnectionBanner() {
  if (connected.value) return null;
  return (
    <div
      role="status"
      class="sticky top-0 z-20 flex animate-[fade-in_200ms_ease-out_800ms_both] items-center justify-center gap-2 border-b border-warning/30 bg-warning/15 px-4 py-2 text-sm text-warning backdrop-blur"
    >
      <WifiOff class="size-4 shrink-0" />
      Connection lost. Reconnecting…
    </div>
  );
}
