// One-shot live price fetch (/api/price) and staleness check, shared by the
// add-asset form and the transaction form's price prefill/refresh.

/**
 * Whether a cached price's sync timestamp is still fresh (within `maxAgeMs`,
 * default 1 hour). Null/unparseable timestamps are never fresh.
 */
export function isPriceFresh(
  syncedAt: string | null,
  now = Date.now(),
  maxAgeMs = 3_600_000,
): boolean {
  if (!syncedAt) return false;
  const t = Date.parse(syncedAt);
  return Number.isFinite(t) && t > 0 && now - t < maxAgeMs;
}

/**
 * Fetch a current price for `q` (ISIN/WKN/symbol) in `currency` via the
 * /api/price proxy. `name` is a fallback Yahoo search query for identifiers
 * that don't resolve directly. Returns null on any failure or a non-positive
 * price — never throws.
 */
export async function fetchLivePrice(
  q: string,
  currency: string,
  name?: string,
): Promise<number | null> {
  try {
    const res = await fetch(
      `/api/price?q=${encodeURIComponent(q)}&currency=${encodeURIComponent(currency)}${
        name ? `&name=${encodeURIComponent(name)}` : ""
      }`,
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { found?: boolean; price?: number };
    return d.found && typeof d.price === "number" && d.price > 0 ? d.price : null;
  } catch {
    return null;
  }
}
