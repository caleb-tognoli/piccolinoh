import { cn } from "../ui/cn";
import { History } from "./History";
import { Queue } from "./Queue";

/** Queue + history. Beside the player (below it in theater mode) on wide screens; under the room on phones. */
export function Sidebar({ theater }: { theater?: boolean }) {
  return (
    <aside
      class={cn(
        "flex min-w-0 flex-col gap-4 lg:col-start-3",
        theater ? "lg:row-start-2" : "lg:row-span-2 lg:row-start-1",
      )}
    >
      <Queue />
      <History />
    </aside>
  );
}
