// Display formatting helpers. Number/date/currency formatting follows the active
// locale (set via the i18n provider); pass `undefined` historically meant "use
// the runtime default" — now we route through the chosen preference.

import { intlLocale } from "./i18n/locale";

/** Decode the few HTML entities that appear in seeded/fetched asset names. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'");
}

/**
 * Parse a user-entered number tolerant of a decimal comma (de-DE) and spaces —
 * e.g. "0,25" → 0.25. Returns NaN for blank/invalid input.
 */
export function parseDecimal(s: string): number {
  const cleaned = String(s).trim().replace(/\s/g, "").replace(",", ".");
  return cleaned === "" ? NaN : Number(cleaned);
}

/**
 * Drop a leading zero a user typed in front of a real number, so a field
 * pre-filled with "0" doesn't turn "300" into "0300". Keeps a lone "0" and
 * decimals like "0.5" / "0,5" intact.
 */
export function stripLeadingZero(s: string): string {
  return s.replace(/^0+(?=\d)/, "");
}

export function formatCurrency(value: number, currency = "EUR"): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCompactCurrency(value: number, currency = "EUR"): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(fraction: number, digits = 2): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  }).format(fraction);
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat(intlLocale(), {
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(iso: string): string {
  const day = iso.slice(0, 10);
  return new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(day + "T00:00:00"));
}

/**
 * Date + time of day for a transaction. The time is treated as a floating
 * wall-clock — the literal Y/M/D H:M from the stored value are displayed
 * verbatim, with NO timezone conversion — so it always matches what the user
 * picked, regardless of the viewer's timezone or how it was persisted
 * (naive string, `...Z`, or `...+00:00` from a timestamptz column).
 */
export function formatDateTime(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return iso;
  const [, y, mo, d, hh = "00", mm = "00"] = m;
  const local = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
  );
  return new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(local);
}

/** Tailwind text color class for a signed value. */
export function plColor(value: number): string {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-zinc-500";
}
