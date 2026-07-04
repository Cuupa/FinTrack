"use client";

// Phase 3 of offline mode (OFFLINE_DESIGN.md §2): a bottom-right floating
// status pill for reconnect sync, reusing the CSV-import pill's visual
// pattern (app/page.tsx's `importStatus`) — same position, shell, and
// spinner, but driven by `useSync()` instead of local component state since
// sync can be triggered from anywhere (reconnect, tab refocus), not just a
// just-closed modal.
//
// Deliberately stateless: visibility derives entirely from the context.
// Auto-hide of the "Synced" pill is the *context* reverting `status` to
// "idle" after ~4s (see SYNCED_LINGER_MS in sync-context.tsx) — the timer
// lives in the async sync continuation there, so this component needs no
// effect-driven state at all (Next 16's react-hooks/set-state-in-effect
// lint rule fails the build on sync setState inside effects).
//
// Two independent surfaces, stacked:
//   - the status pill: "Syncing N changes…" → "Synced" (auto-hides), or
//     "paused" (sticky, prompts re-login — never auto-hides, since the queue
//     is stuck until the user acts);
//   - a dropped-ops toast: sticky with a manual dismiss, because a dropped op
//     is data the user asked to save that didn't make it (OFFLINE_DESIGN.md
//     §4 rule 2 — a cross-device delete won) and deserves a deliberate ack,
//     not a timer.

import Link from "next/link";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useSync } from "@/lib/offline/sync-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export function SyncPill() {
  const enabled = useFeatureFlag("offline");
  const { pending, status, dropped, dismissDropped } = useSync();
  const { t } = useI18n();

  if (!enabled) return null;

  const showStatusPill = status !== "idle";
  const showDroppedToast = dropped > 0;
  if (!showStatusPill && !showDroppedToast) return null;

  return (
    <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2 md:bottom-6">
      {showStatusPill && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {status === "syncing" && (
            <>
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
              <span>
                {t("sync.syncingLabel")} {pending} {t("sync.changesUnit")}
              </span>
            </>
          )}
          {status === "synced" && (
            <span className="text-emerald-600 dark:text-emerald-400">{t("sync.synced")}</span>
          )}
          {status === "paused" && (
            <>
              <span className="text-amber-600 dark:text-amber-400">{t("sync.paused")}</span>
              <Link href="/login" className="shrink-0 font-semibold underline underline-offset-2">
                {t("sync.pausedAction")}
              </Link>
            </>
          )}
        </div>
      )}
      {showDroppedToast && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-lg dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <span>
            {dropped} {t("sync.droppedUnit")}
          </span>
          <button
            type="button"
            onClick={dismissDropped}
            aria-label="Close"
            className="shrink-0 rounded-full text-amber-500 hover:text-amber-800 dark:hover:text-amber-100"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
