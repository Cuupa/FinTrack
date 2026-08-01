// The price cron's retry queue: which rows failed last time, when they may be
// tried again, and in what order.
//
// Yahoo rate-limits. When it does, `getJSON` opens a cooldown breaker and every
// remaining row in that sweep comes back empty -- and until now the sweep simply
// ended, leaving those rows to wait for the next ordinary run, which treats them
// exactly like the hundreds that priced fine. Worse, the expensive hint-less
// re-resolution only runs in the 03 UTC hour, so a row that needed it and was
// rate-limited out of it waited a full day for its next chance, every day, for
// as long as the 03 UTC run kept being the unlucky one.
//
// So a row that ends a sweep without a price is stamped, and a stamped row goes
// FIRST in the next sweep (the Yahoo limiter serves in call order) and gets the
// self-heal treatment right then instead of at 03 UTC.
//
// Pure and dependency-free, like `quote-policy.ts` next to it, so the rule can
// be unit-tested without a cron run, a database or a Yahoo round trip.

/** The parts of an `instruments` row the retry queue depends on (migration 0114). */
export interface PriceRetryRow {
  price_failed_at?: string | null;
  price_fail_count?: number | null;
}

/** First retry delay. Short enough that an hourly cron picks a failure up on
 *  its very next run, long enough that a row failing inside one sweep is not
 *  re-tried within it. */
const BASE_DELAY_MS = 30 * 60 * 1000;
/** Ceiling, so a genuinely unresolvable row (a German certificate Yahoo has
 *  never heard of) still checks back daily instead of burning a full search on
 *  every sweep forever. */
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

/** Backoff for the n-th consecutive failure, capped. */
export function retryDelayMs(failCount: number): number {
  if (failCount <= 0) return 0;
  const delay = BASE_DELAY_MS * 2 ** (failCount - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

/** True when the row is in the queue at all (it ended a sweep unpriced). */
export function isQueued(row: PriceRetryRow): boolean {
  return (row.price_fail_count ?? 0) > 0;
}

/**
 * True when a queued row's backoff has elapsed and it deserves the expensive
 * treatment (priority in the sweep + a hint-less re-resolve) on this run.
 *
 * A queued row that is NOT due is never skipped -- it still syncs on the cheap
 * hinted path with everything else. Being due only decides whether it gets to
 * jump the queue and re-resolve from scratch.
 */
export function isRetryDue(row: PriceRetryRow, now: number): boolean {
  if (!isQueued(row)) return false;
  if (!row.price_failed_at) return true; // stamped without a time: treat as due
  const failedAt = Date.parse(row.price_failed_at);
  if (!Number.isFinite(failedAt)) return true;
  return now >= failedAt + retryDelayMs(row.price_fail_count ?? 1);
}

/**
 * Sweep order: rows due for a retry first, oldest failure first, then everything
 * else. The Yahoo limiter serves acquirers in call order, so when the breaker
 * trips mid-sweep the rows that were already stuck are the ones that got served,
 * instead of being cut off again behind rows that are perfectly fresh.
 */
export function compareRetryPriority(a: PriceRetryRow, b: PriceRetryRow, now: number): number {
  const da = isRetryDue(a, now);
  const db = isRetryDue(b, now);
  if (da !== db) return da ? -1 : 1;
  if (!da) return 0;
  const ta = a.price_failed_at ? Date.parse(a.price_failed_at) : 0;
  const tb = b.price_failed_at ? Date.parse(b.price_failed_at) : 0;
  return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
}

/** Patch stamping one more consecutive failure onto a row. */
export function failurePatch(row: PriceRetryRow, at: string): Record<string, unknown> {
  return {
    price_failed_at: at,
    price_fail_count: (row.price_fail_count ?? 0) + 1,
  };
}

/** Patch clearing a row out of the queue, folded into the success update so a
 *  priced row costs no extra round trip. */
export function successPatch(): Record<string, unknown> {
  return { price_failed_at: null, price_fail_count: 0 };
}
