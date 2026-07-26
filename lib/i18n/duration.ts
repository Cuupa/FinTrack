// Month counts as something a human actually reads. "490 months" is a number
// nobody can picture -- a 40-year mortgage should say so (owner rule, round
// 26). Kept next to `slice-label.ts` for the same reason: the finance layer
// stays locale-agnostic and returns a plain month count, and turning that
// count into words happens here.
//
// `t()` has no plural forms, so singular and plural are separate keys and the
// parts are joined rather than templated as one sentence -- "1 Jahre" is
// simply wrong German, and no {n}-interpolation can fix that on its own.

import type { MessageKey } from "./dictionaries";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface DurationParts {
  years: number;
  months: number;
}

/** Splits a whole month count into years + leftover months. */
export function splitMonths(totalMonths: number): DurationParts {
  const total = Math.max(0, Math.round(totalMonths));
  return { years: Math.floor(total / 12), months: total % 12 };
}

/**
 * "490" -> "40 years, 10 months" / "40 Jahre, 10 Monate". A whole number of
 * years drops the months part entirely ("3 Jahre", not "3 Jahre, 0 Monate"),
 * and under a year only the months show.
 */
export function formatMonths(totalMonths: number, t: Translate): string {
  const { years, months } = splitMonths(totalMonths);
  const parts: string[] = [];
  if (years === 1) parts.push(t("duration.year"));
  else if (years > 1) parts.push(t("duration.years", { n: years }));
  if (months === 1) parts.push(t("duration.month"));
  else if (months > 1 || parts.length === 0) parts.push(t("duration.months", { n: months }));
  return parts.join(", ");
}

/**
 * The compact form for a table cell: "40 J. 10 Mon.". Same rules as
 * {@link formatMonths}, joined by a space instead of a comma.
 */
export function formatMonthsShort(totalMonths: number, t: Translate): string {
  const { years, months } = splitMonths(totalMonths);
  const parts: string[] = [];
  if (years > 0) parts.push(t("duration.yearsShort", { n: years }));
  if (months > 0 || parts.length === 0) parts.push(t("duration.monthsShort", { n: months }));
  return parts.join(" ");
}
