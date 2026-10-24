import { useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { History } from "./components/History";
import { Logo } from "./components/Logo";
import { Members } from "./components/Members";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerFrame } from "./components/PlayerFrame";
import { ShortcutsHelp, useKeyboardShortcuts, useShortcutsDialog } from "./components/Shortcuts";
import { Queue } from "./components/Queue";
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
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
          <main class="flex min-w-0 flex-col gap-4">
            <PlayerFrame />
            <NowPlaying />
          </main>
          <aside class="flex min-w-0 flex-col gap-4">
            <Queue />
            <Members />
            <History />
          </aside>
        </div>
        <Toast />
      </div>
    </>
  );
}
