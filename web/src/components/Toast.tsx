import { toast } from "../store";

export function Toast() {
  return (
    <div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-4 z-10 flex justify-center px-4">
      {toast.value && (
        <div class="max-w-md rounded-lg border border-accent/40 bg-raised px-4 py-2.5 text-sm shadow-xl shadow-black/50">
          {toast.value}
        </div>
      )}
    </div>
  );
}
