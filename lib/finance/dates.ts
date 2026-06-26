// Date helpers used by the charting and finance code. All series work in
// whole days using `YYYY-MM-DD` keys to stay timezone-stable.

export type Timeframe = "1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y" | "10Y" | "MAX";

export const TIMEFRAMES: Timeframe[] = [
  "1W",
  "1M",
  "3M",
  "YTD",
  "1Y",
  "5Y",
  "10Y",
  "MAX",
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The day part (YYYY-MM-DD) of a date or datetime ISO string. */
export function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

export function parseISODate(iso: string): Date {
  // Accept both date-only ("2024-01-15") and datetime ("2024-01-15T14:30")
  // strings; date-only is anchored to UTC midnight for stability.
  return iso.includes("T") ? new Date(iso) : new Date(iso + "T00:00:00Z");
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(parseISODate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round(
    (parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / DAY_MS,
  );
}

export function today(): string {
  return toISODate(new Date());
}

/** Current local date+time as "YYYY-MM-DDTHH:MM" for datetime-local inputs. */
export function nowDateTimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Resolve a timeframe to a start date. `MAX`/`YTD` need an `earliest`
 * reference (the first transaction date) to bound the range sensibly.
 */
export function timeframeStart(
  tf: Timeframe,
  end: string,
  earliest: string | null,
): string {
  const endDate = parseISODate(end);
  switch (tf) {
    case "1W":
      return addDays(end, -7);
    case "1M":
      return addDays(end, -30);
    case "3M":
      return addDays(end, -91);
    case "YTD":
      return toISODate(new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1)));
    case "1Y":
      return addDays(end, -365);
    case "5Y":
      return addDays(end, -365 * 5);
    case "10Y":
      return addDays(end, -365 * 10);
    case "MAX":
      return earliest ?? addDays(end, -365);
  }
}

/**
 * Build an evenly-spaced list of date keys between `start` and `end`,
 * capping the count so charts stay responsive over long ranges.
 */
export function dateRange(start: string, end: string, maxPoints = 240): string[] {
  const span = Math.max(0, daysBetween(start, end));
  if (span === 0) return [end];
  const step = Math.max(1, Math.ceil(span / maxPoints));
  const out: string[] = [];
  for (let d = 0; d <= span; d += step) out.push(addDays(start, d));
  if (out[out.length - 1] !== end) out.push(end);
  return out;
}
