// Pure aggregation for the /admin overview health tiles. Kept separate from
// the page component so the counting logic (which staleness bands roll up
// into which tile) is unit-testable without mocking Supabase, same spirit as
// lib/admin/price-health.ts.

import { priceStaleness } from "./price-health";

export interface InstrumentHealthRow {
  last_price: number | string | null;
  price_synced_at: string | null;
}

export interface InstrumentHealthSummary {
  total: number;
  /** Needs a look soon: `stale` or `unknown` (no recorded sync time). */
  stale: number;
  /** Hasn't synced in over a day (the prices cron's daily self-heal window). */
  dead: number;
  /** No real `last_price` at all: the app is pricing this synthetically. */
  synthetic: number;
}

function numOrNull(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rolls up `instruments` rows into the four overview counts. `unknown`
 * (no `price_synced_at` at all) is folded into `stale` rather than getting
 * its own tile: it needs the same operator attention as a merely-stale row,
 * just without a definite age (see admin/prices's `needsAttention`, which
 * treats stale/dead/unknown the same way).
 */
export function summarizeInstrumentHealth(
  rows: readonly InstrumentHealthRow[],
  now: number = Date.now(),
): InstrumentHealthSummary {
  let stale = 0;
  let dead = 0;
  let synthetic = 0;
  for (const row of rows) {
    const status = priceStaleness(row.price_synced_at, now);
    if (status === "dead") dead++;
    else if (status === "stale" || status === "unknown") stale++;
    if (numOrNull(row.last_price) == null) synthetic++;
  }
  return { total: rows.length, stale, dead, synthetic };
}
