"use client";

// Small amber pill flagging fabricated/synthetic data — shown wherever a
// chart or price has no real market data behind it (production trust
// requirement: fabricated series/prices must never look identical to real
// market data in the UI). Visual language matches the "Estimate" badge in the
// Monte Carlo per-asset model panel (components/simulation/monte-carlo-panel.tsx).
// Globally toggleable via the `estimated-badge` feature flag (feature_flags
// table) — gated here so every render site (hero chart, asset detail,
// holdings table) is covered without each caller checking the flag itself.

import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { InfoTip } from "@/components/ui/info-tip";

export function EstimatedBadge({
  tip,
  compact = false,
  className = "",
}: {
  /** Tooltip body; defaults to the generic "no real market data" explanation. */
  tip?: string;
  /**
   * Icon-only form (amber dot + info tip, no text pill) for tight spaces like
   * a table cell, where the full labelled pill would crowd the row.
   */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const enabled = useFeatureFlag("estimated-badge");
  const tipText = tip ?? t("data.estimatedTip");
  if (!enabled) return null;
  if (compact) {
    // Native `title` tooltip (rather than the InfoTip popover) keeps this
    // legible at table-row density; mirrors the compact "ⓘ" glyph used by
    // RiskDisclaimer's footnote variant.
    return (
      <span
        role="img"
        aria-label={`${t("data.estimatedBadge")}: ${tipText}`}
        title={tipText}
        className={`ml-1 cursor-help align-middle text-amber-500 dark:text-amber-400 ${className}`}
      >
        ⓘ
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-200 ${className}`}
    >
      {t("data.estimatedBadge")}
      <InfoTip text={tipText} />
    </span>
  );
}
