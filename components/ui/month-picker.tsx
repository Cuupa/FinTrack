"use client";

// The page-level month filter for /cashflow and /accounts.
//
// It replaces the per-card picker the budgets card used to own: one page, one
// answer to "which month am I looking at". `null` means every month, which is
// how both pages behave with no selection -- a filter you cannot clear would
// hide the totals the pages exist to show.

import { shiftMonth, today } from "@/lib/finance/dates";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button } from "./primitives";

export function MonthPicker({
  value,
  onChange,
}: {
  /** `YYYY-MM`, or null for every month. */
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t, locale } = useI18n();

  // From "all months" the arrows start at the current month, so the first
  // click lands somewhere the user recognises rather than at an epoch.
  const step = (delta: number) => onChange(shiftMonth(value ?? today().slice(0, 7), delta));

  const label = value
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
        new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1)),
      )
    : t("common.allMonths");

  return (
    <div className="flex items-center gap-2 text-sm">
      <Button size="sm" variant="secondary" aria-label="‹" onClick={() => step(-1)}>
        ‹
      </Button>
      <span className="min-w-[8rem] text-center font-medium">{label}</span>
      <Button size="sm" variant="secondary" aria-label="›" onClick={() => step(1)}>
        ›
      </Button>
      {value && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("common.allMonths")}
          title={t("common.allMonths")}
          onClick={() => onChange(null)}
        >
          ×
        </Button>
      )}
    </div>
  );
}

/** True when `date` (a `YYYY-MM-DD` string) falls in `month`, or when there is
 *  no month filter at all. Kept here so every surface filters identically. */
export function inMonth(date: string, month: string | null): boolean {
  return month === null || date.slice(0, 7) === month;
}
