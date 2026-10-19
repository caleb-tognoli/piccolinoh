import { connected, toast } from "../store";

export function Toast() {
  const t = toast.value;
  return (
    <div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-4 z-10 flex justify-center px-4">
      {t && (
        <div class="pointer-events-auto flex max-w-md items-center gap-4 rounded-lg border border-accent/40 bg-raised py-2.5 pr-2.5 pl-4 text-sm shadow-xl shadow-black/50">
          <span class="line-clamp-2 min-w-0">{t.text}</span>
          {t.action && (
            <button
              type="button"
              class="shrink-0 cursor-pointer rounded-md px-2 py-1 font-semibold text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!connected.value}
              onClick={t.action.run}
            >
              {t.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
