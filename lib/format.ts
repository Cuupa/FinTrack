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

export function formatCurrency(value: number, currency = "EUR", digits?: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency,
    // When `digits` is given, pin both bounds so every value carries the same
    // number of decimals (e.g. a whole 5 renders as "5.00" next to "4.50").
    ...(digits != null
      ? { minimumFractionDigits: digits, maximumFractionDigits: digits }
      : { maximumFractionDigits: 2 }),
  }).format(value);
}

/** Number of decimal places in `v` (capped), for aligning a set of axis ticks. */
export function decimalPlaces(v: number, cap = 2): number {
  for (let d = 0; d < cap; d++) {
    if (Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-9) return d;
  }
  return cap;
}

/**
 * Short axis-style currency label ("€25k", "12,5k €"). Intl's own compact
 * notation is NOT used because it doesn't shorten thousands in every locale —
 * de-DE spells 25,000 out in full ("25.000,0 €") and only compacts at
 * millions — so we scale the value ourselves and append a universal k/M/B
 * magnitude suffix (deliberately locale-neutral for a technical axis, rather
 * than "Tsd."/"Mrd."). Intl still formats the scaled number, so decimal
 * separators and the currency symbol's position stay locale-correct.
 * Values under 10k keep their full digits (4-digit values don't compact).
 */
export function formatCompactCurrency(value: number, currency = "EUR"): string {
  const abs = Math.abs(value);
  const [divisor, suffix] =
    abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e4 ? [1e3, "k"] : [1, ""];
  const parts = new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency,
    // Explicit 0 floor: leaving it unset would clamp the currency default (2)
    // to maximumFractionDigits and force a junk trailing ",0" onto whole values.
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).formatToParts(value / divisor);
  if (!suffix) return parts.map((p) => p.value).join("");
  // Inject the suffix right after the last numeric part so the currency
  // symbol keeps its locale position ("€25k" in en, "25k €" in de).
  const NUMERIC = new Set(["integer", "group", "decimal", "fraction"]);
  let last = -1;
  parts.forEach((p, i) => {
    if (NUMERIC.has(p.type)) last = i;
  });
  return parts.map((p, i) => (i === last ? p.value + suffix : p.value)).join("");
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

/**
 * Date + time of a real instant (e.g. a share link's `expires_at`
 * timestamptz) — unlike `formatDateTime`, this DOES convert to the viewer's
 * local timezone, since the underlying value is an absolute point in time
 * rather than a floating wall-clock entry.
 */
export function formatInstant(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Tailwind text color class for a signed value. */
export function plColor(value: number): string {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-zinc-500";
}
