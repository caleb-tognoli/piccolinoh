import { useState } from "preact/hooks";
import { presence, session } from "../store";
import { cn } from "../ui/cn";
import { History } from "./History";
import { Members } from "./Members";
import { Queue } from "./Queue";

type Tab = "queue" | "room";

/** Queue + room. Stacked on wide screens; tabs on phones so neither is a long scroll away. */
export function Sidebar() {
  const [tab, setTab] = useState<Tab>("queue");
  const tabs: [Tab, string, number][] = [
    ["queue", "Queue", session.value?.queue.length ?? 0],
    ["room", "Room", presence.value.length],
  ];
  const shownOn = (t: Tab) => (tab === t ? "flex" : "hidden lg:flex");

  return (
    <aside class="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
      <div role="tablist" aria-label="Queue and room" class="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 lg:hidden">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            class={cn(
              "flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors",
              tab === id ? "bg-raised text-ink" : "text-muted hover:text-ink",
            )}
            onClick={() => setTab(id)}
          >
            {label}
            <span class="text-xs text-muted tabular-nums">{count}</span>
          </button>
        ))}
      </div>
      <div id="panel-queue" role="tabpanel" aria-labelledby="tab-queue" class={cn(shownOn("queue"), "flex-col gap-4")}>
        <Queue />
      </div>
      <div id="panel-room" role="tabpanel" aria-labelledby="tab-room" class={cn(shownOn("room"), "flex-col gap-4")}>
        <Members />
      </div>
      {/* Under the room list on wide screens; part of the Queue tab on phones. */}
      <div class={cn(shownOn("queue"), "flex-col")}>
        <History />
      </div>
    </aside>
  );
}
