import { useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { Logo } from "./components/Logo";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerFrame } from "./components/PlayerFrame";
import { Sidebar } from "./components/Sidebar";
import { ShortcutsHelp, useKeyboardShortcuts, useShortcutsDialog } from "./components/Shortcuts";
import { Toast } from "./components/Toast";
import { session } from "./store";

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
  return (
    <>
      <ConnectionBanner />
      <div class="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:p-6">
        <header class="flex items-center">
          <Logo />
          {/* Shortcuts only matter with a keyboard; hide the button on touch screens. */}
          <div class="ml-auto hidden pointer-fine:block">
            <ShortcutsHelp dialogRef={shortcutsRef} />
          </div>
        </header>
        {/* One grid for everything, so on phones the player can stay pinned while the page scrolls. */}
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-6">
          <main class="contents">
            <div class="sticky top-0 z-10 -mx-4 bg-bg/95 px-4 py-2 backdrop-blur lg:static lg:m-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <PlayerFrame />
            </div>
            <div class="lg:col-start-1">
              <NowPlaying />
            </div>
          </main>
          <Sidebar />
        </div>
        <Toast />
      </div>
    </>
  );
}
