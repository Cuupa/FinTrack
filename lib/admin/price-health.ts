// Pure staleness classification for `instruments.price_synced_at`, used by
// the /admin/prices health table. Bands: fresh < 2h (well within the cron's
// normal cadence), stale < 26h (a day's cron cycle plus slack — the prices
// cron's daily self-heal runs in the 03:00 UTC hour, see
// app/api/cron/sync/prices/route.ts), dead >= 26h. `unknown` covers a null
// or unparseable timestamp — a row with a real `last_price` but no recorded
// sync time, which callers treat as needing attention just like stale/dead.
//
// No React, no Supabase — a plain function so it's unit-testable without
// mocking the client, same spirit as lib/live/fetch-price.ts's
// `isPriceFresh`.

export type PriceStaleness = "fresh" | "stale" | "dead" | "unknown";

const FRESH_MS = 2 * 60 * 60 * 1000; // 2h
const STALE_MS = 26 * 60 * 60 * 1000; // 26h

export function priceStaleness(
  syncedAt: string | null,
  now: number = Date.now(),
): PriceStaleness {
  if (!syncedAt) return "unknown";
  const t = Date.parse(syncedAt);
  if (!Number.isFinite(t) || t <= 0) return "unknown";
  const age = now - t;
  // A timestamp in the future (clock skew) is at least as fresh as "now".
  if (age <= FRESH_MS) return "fresh";
  if (age < STALE_MS) return "stale";
  return "dead";
}

/**
 * Whether a row should show up under the "stale only" filter: no real price
 * at all (synthetic fallback), or a `price_synced_at` that isn't fresh.
 */
export function needsAttention(
  lastPrice: number | null,
  syncedAt: string | null,
  now: number = Date.now(),
): boolean {
  if (lastPrice == null) return true;
  return priceStaleness(syncedAt, now) !== "fresh";
}
