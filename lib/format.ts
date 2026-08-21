// Display formatting helpers. Number/date/currency formatting follows the active
// locale (set via the i18n provider); pass `undefined` historically meant "use
// the runtime default" — now we route through the chosen preference.

import { getActiveLocale, intlLocale } from "./i18n/locale";

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
 * Parse a user-entered number tolerant of a decimal comma (de-DE/es-ES), of
 * THOUSANDS separators in either convention, and of spaces — "0,25" → 0.25,
 * "250.000" → 250000 (de), "250,000.50" → 250000.5 (en). Returns NaN for
 * blank/invalid input.
 *
 * Grouping support is not cosmetic: replacing only the first comma turned a
 * mortgage typed as "250.000" into 250 euros (silently — the caller just sees a
 * finite number) and "250.000,00" into NaN, which every call site drops with a
 * bare `return`, so the form looked broken.
 *
 * Which separator is the decimal point:
 * - both present  => the LAST one (the other groups): "1.234,50", "1,234.50".
 * - one, repeated => grouping, and only in a well-formed pattern ("1.2.3" is
 *   not a number in any locale, so it stays NaN).
 * - one, once     => the decimal point, UNLESS it is the active locale's
 *   grouping separator in front of exactly three digits. So "1.5" is 1.5 even
 *   on a German UI, while "250.000" there is 250000.
 */
export function parseDecimal(s: string): number {
  // \s covers the non-breaking and narrow no-break spaces Intl emits, so a
  // pasted "250 000,50" round-trips.
  const cleaned = String(s).replace(/\s/g, "");
  if (cleaned === "") return NaN;

  const dot = cleaned.lastIndexOf(".");
  const comma = cleaned.lastIndexOf(",");
  if (dot < 0 && comma < 0) return Number(cleaned);

  // null = there is no decimal point at all, every separator groups.
  let decimal: "." | "," | null;
  if (dot >= 0 && comma >= 0) {
    decimal = dot > comma ? "." : ",";
  } else {
    const sep: "." | "," = dot >= 0 ? "." : ",";
    const at = Math.max(dot, comma);
    if (cleaned.indexOf(sep) !== at) {
      if (!new RegExp(`^-?\\d{1,3}(?:\\${sep}\\d{3})+$`).test(cleaned)) return NaN;
      decimal = null;
    } else if (!/^\d{3}$/.test(cleaned.slice(at + 1))) {
      decimal = sep;
    } else {
      decimal = sep === (getActiveLocale() === "en" ? "." : ",") ? sep : null;
    }
  }

  const normalized =
    decimal === null
      ? cleaned.replace(/[.,]/g, "")
      : cleaned.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  return normalized === "" ? NaN : Number(normalized);
}

/** Locale-aware decimal text for form fields; grouping is intentionally off. */
export function formatInputDecimal(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(intlLocale(), {
    useGrouping: false,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Drop a leading zero a user typed in front of a real number, so a field
 * pre-filled with "0" doesn't turn "300" into "0300". Keeps a lone "0" and
 * decimals like "0.5" / "0,5" intact.
 */
export function stripLeadingZero(s: string): string {
  const locale = getActiveLocale();
  const localized =
    locale === "en"
      ? s
      : s.replace(/(\d)\.(\d{1,2})(?!\d)/g, "$1,$2");
  return localized.replace(/^0+(?=\d)/, "");
}

/**
 * Snap a value that rounds to zero at the displayed precision to positive zero,
 * so a tiny negative (or a literal -0) never renders as "-0,00". Any value that
 * still rounds to a nonzero figure is returned untouched.
 */
export function normalizeZero(value: number, decimals: number): number {
  return Math.round(value * 10 ** decimals) === 0 ? 0 : value;
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
  }).format(normalizeZero(value, digits ?? 2));
}

/** Number of decimal places in `v` (capped), for aligning a set of axis ticks. */
export function decimalPlaces(v: number, cap = 2): number {
  for (let d = 0; d < cap; d++) {
    if (Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-9) return d;
  }
  return cap;
}

export type CompactUnit = { divisor: number; suffix: string };

/**
 * Pick a single compact magnitude (k / M / B) for a whole axis from its
 * largest absolute tick, so every tick on that axis abbreviates the same way.
 */
export function compactUnitFor(maxAbs: number): CompactUnit {
  if (maxAbs >= 1e9) return { divisor: 1e9, suffix: "B" };
  if (maxAbs >= 1e6) return { divisor: 1e6, suffix: "M" };
  if (maxAbs >= 1e4) return { divisor: 1e3, suffix: "k" };
  return { divisor: 1, suffix: "" };
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
 * Pass `unit` (from `compactUnitFor`) to force a single magnitude across a
 * whole axis instead of picking one per value.
 */
export function formatCompactCurrency(value: number, currency = "EUR", unit?: CompactUnit): string {
  const { divisor, suffix } = unit ?? compactUnitFor(Math.abs(value));
  const scaled = normalizeZero(value / divisor, 1);
  const parts = new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency,
    // Explicit 0 floor: leaving it unset would clamp the currency default (2)
    // to maximumFractionDigits and force a junk trailing ",0" onto whole values.
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).formatToParts(scaled);
  if (!suffix || scaled === 0) return parts.map((p) => p.value).join("");
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
  }).format(normalizeZero(fraction, digits + 2));
}

/**
 * An unsigned percentage, for a LEVEL rather than a change: a success
 * probability, a share, a quota. `formatPercent` above forces a sign because
 * almost every percentage in this app is a return, and "+88%" reading as a
 * survival probability is simply wrong.
 */
export function formatPercentPlain(fraction: number, digits = 1): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(normalizeZero(fraction, digits + 2));
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat(intlLocale(), {
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(iso: string): string {
  const day = iso.slice(0, 10);
  // The locale's own all-numeric form: 27.07.2026 (de), 07/27/2026 (en),
  // 27/07/2026 (es). Deliberately NOT `month: "short"` ("27. Juli 2026"),
  // which was a second date format competing with the raw ISO strings a few
  // tables still printed -- three shapes for one kind of value. Two-digit day
  // and month keep the column width stable, which a table needs and the bare
  // locale default ("27.7.2026") does not give.
  return new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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

/** Tailwind text color class for a signed value, on the semantic tokens. */
export function plColor(value: number): string {
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return "text-tertiary";
}
