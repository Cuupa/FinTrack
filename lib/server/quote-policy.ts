// Who owns an instrument's quote listing: the seed, or the daily search.
//
// Pure and dependency-free so the rule can be unit-tested without a cron run,
// a database or a Yahoo round trip. It exists because the same bug has now
// been reported twice: VWCE (IE00BK5BQT80) is seeded with the EUR Xetra line
// VWCE.DE, but Yahoo's search for that ISIN does not return VWCE.DE at all, so
// the daily self-heal -- which drops the stored hint so a genuinely stuck
// quote_id can recover (the GME case) -- re-resolved to the USD London line
// VWRA.L and wrote it over the seed.
//
// Currency cannot arbitrate between the two cases: GME's wrong listing
// (GME.F, Geratherm Medical) was in the instrument's currency too, so "keep
// whichever hint matches the currency" would have re-broken it. Provenance
// can, which is why the decision reads `quotePinned` and nothing else.

/** The parts of an `instruments` row the policy depends on. */
export interface QuoteListingRow {
  type: string;
  quote_source: string | null;
  quote_id: string | null;
  quote_pinned?: boolean | null;
}

/**
 * True when the row's stored listing is owner-curated and must be reused
 * verbatim: never re-resolved by search, never overwritten, never replaced by
 * the onvista fallback.
 *
 * COMMODITY is included unconditionally — its seeded listing was already
 * authoritative in the cron before `quote_pinned` existed (a bare metal ticker
 * mis-resolves and once put gold at 1.42 EUR), and a database that has not yet
 * run migration 0107 reports `quote_pinned` as undefined, so the type check is
 * what keeps that guarantee during the window between deploy and migration.
 */
export function hasAuthoritativeListing(row: QuoteListingRow): boolean {
  return row.type === "COMMODITY" || row.quote_pinned === true;
}

/** True when the row carries a usable Yahoo hint. */
export function hasYahooHint(row: QuoteListingRow): boolean {
  return row.quote_source === "yahoo" && !!row.quote_id;
}

/**
 * The hint to pass to `resolveQuote`, or undefined to re-resolve from scratch.
 *
 * `revalidate` is the daily (03 UTC) or `?revalidate=1` self-heal. It drops
 * the hint for ordinary rows so a stuck listing can recover — but never for an
 * authoritative one, which is the whole point of pinning.
 */
export function listingHint(row: QuoteListingRow, revalidate: boolean): string | undefined {
  if (!hasYahooHint(row)) return undefined;
  if (hasAuthoritativeListing(row) || !revalidate) return row.quote_id as string;
  return undefined;
}

/**
 * Whether a freshly resolved symbol may be written back to the row.
 *
 * An authoritative row never learns: the seed is the source of truth, and a
 * search result that disagrees with it is the bug, not the fix.
 */
export function learnsListing(row: QuoteListingRow, resolvedSymbol: string | null): boolean {
  if (hasAuthoritativeListing(row)) return false;
  if (!resolvedSymbol) return false;
  return row.quote_source !== "yahoo" || row.quote_id !== resolvedSymbol;
}
