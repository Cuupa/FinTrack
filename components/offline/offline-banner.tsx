"use client";

// Phase 1 of offline mode (OFFLINE_DESIGN.md §2): a non-blocking banner that
// tells the user they're viewing last-known data while offline. Service
// worker registration itself stays unconditional (it's harmless and already
// ships) — only this UI affordance is gated behind the `offline` feature
// flag, per the design's flag-gating note.

import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { formatDateTime } from "@/lib/format";

export function OfflineBanner() {
  const enabled = useFeatureFlag("offline");
  const { online } = useOnlineStatus();
  const { asOf } = useLivePrices();
  const { t } = useI18n();

  if (!enabled || online) return null;

  return (
    <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden>📴</span>
        <span>
          {asOf ? `${t("offline.bannerPrefix")} ${formatDateTime(asOf)}` : t("offline.bannerNoData")}
        </span>
      </div>
    </div>
  );
}
