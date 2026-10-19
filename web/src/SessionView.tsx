import { ConnectionBanner } from "./components/ConnectionBanner";
import { Logo } from "./components/Logo";
import { Members } from "./components/Members";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerFrame } from "./components/PlayerFrame";
import { Queue } from "./components/Queue";
import { Toast } from "./components/Toast";

export function SessionView() {
  return (
    <>
      <ConnectionBanner />
      <div class="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:p-6">
        <header class="flex items-center">
          <Logo />
        </header>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
          <main class="flex min-w-0 flex-col gap-4">
            <PlayerFrame />
            <NowPlaying />
          </main>
          <aside class="flex min-w-0 flex-col gap-4">
            <Queue />
            <Members />
          </aside>
        </div>
        <Toast />
      </div>
    </>
  );
}
