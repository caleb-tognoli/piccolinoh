import { useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { Logo } from "./components/Logo";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerFrame } from "./components/PlayerFrame";
import { Sidebar } from "./components/Sidebar";
import { ShortcutsHelp, useKeyboardShortcuts, useShortcutsDialog } from "./components/Shortcuts";
import { Toast } from "./components/Toast";
import { session, theater } from "./store";
import { cn } from "./ui/cn";

const APP_TITLE = "piccolinoh";

/** "▶ Song — piccolinoh" in the browser tab, so the room is findable among tabs. */
function useNowPlayingTitle(): void {
  useSignalEffect(() => {
    const current = session.value?.current;
    const icon = current?.pausedAtPositionSec != null ? "⏸" : "▶";
    document.title = current ? `${icon} ${current.title} — ${APP_TITLE}` : APP_TITLE;
  });
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
}

export function SessionView() {
  useNowPlayingTitle();
  const [shortcutsRef, openShortcuts] = useShortcutsDialog();
  useKeyboardShortcuts(openShortcuts);
  const wide = theater.value;
  return (
    <>
      <ConnectionBanner />
      <header class="flex h-(--header-h) items-center px-4 lg:px-6">
        <Logo />
        {/* Shortcuts only matter with a keyboard; hide the button on touch screens. */}
        <div class="ml-auto hidden pointer-fine:block">
          <ShortcutsHelp dialogRef={shortcutsRef} />
        </div>
      </header>
      {/*
        One grid for everything, so on phones the player can stay pinned while the page scrolls.
        Wide screens get four columns: two flexible gutters around the player and the sidebar,
        so the pair stays centred and the player can also span the whole width (theater mode).
        Only classes change between modes; moving the player in the DOM would reload the video.
      */}
      <div
        class={cn(
          "grid gap-4 px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,var(--player-w))_var(--side-w)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:px-0 lg:pb-6",
          !wide && "lg:pt-2",
        )}
      >
        <main class="contents">
          <div
            class={cn(
              "sticky top-0 z-10 -mx-4 bg-bg/95 px-4 py-2 backdrop-blur lg:static lg:m-0 lg:p-0 lg:backdrop-blur-none",
              wide ? "lg:col-span-full lg:bg-black" : "lg:col-start-2 lg:bg-transparent",
            )}
          >
            <PlayerFrame theater={wide} />
          </div>
          <div class="lg:col-start-2">
            <NowPlaying />
          </div>
        </main>
        <Sidebar theater={wide} />
      </div>
      <Toast />
    </>
  );
}
