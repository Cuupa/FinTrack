// Shareable portfolio snapshots. The snapshot is created once and either stored
// server-side (referenced by a short id, the default) or — as a fallback when no
// backend is available — encoded in the URL fragment.
//
// A "full" share carries absolute values; an "incognito" share carries ONLY
// relative data (allocations, returns, TWROR/IRR percentages) — no absolute
// figures exist in the payload, so the recipient cannot reveal them.

export interface SharePt {
  date: string;
  value: number;
}

export interface ShareHolding {
  name: string;
  type: string;
  /** Portfolio weight, fraction 0..1. */
  allocation: number;
  /** Unrealised return, fraction. */
  ret: number;
  /** Absolute value in base currency, or null in incognito shares. */
  value: number | null;
}

export interface SharePayload {
  v: 2;
  incognito: boolean;
  /** True for a live (auto-refreshed by the owner) share. */
  live?: boolean;
  /** Owner's display name, for the shared title ("Simon's Portfolio"). */
  ownerName?: string | null;
  /** Portfolios this share covers (for rebuilding live shares); null = all. */
  portfolioIds?: string[] | null;
  currency: string;
  createdAt: string;
  /** Net worth in base currency, or null in incognito shares. */
  netWorth: number | null;
  /** Money-weighted return (IRR), fraction, or null. */
  irr: number | null;
  /** Final cumulative time-weighted return over the series, fraction, or null. */
  twr: number | null;
  /** Cumulative TWROR series (relative — included in both modes). */
  twrSeries: SharePt[];
  /** Absolute net-worth series (full shares only). */
  wealthSeries: SharePt[] | null;
  holdings: ShareHolding[];
}

export interface ShareSource {
  ownerName: string | null;
  /** Portfolios this snapshot was built from; null = all. */
  portfolioIds: string[] | null;
  currency: string;
  netWorth: number;
  irr: number | null;
  twr: number | null;
  twrSeries: SharePt[];
  wealthSeries: SharePt[];
  holdings: { name: string; type: string; marketValue: number; ret: number }[];
}

/** Round to `d` decimals (keeps payloads small — raw floats are absurdly long). */
function r(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function roundSeries(s: SharePt[], d: number): SharePt[] {
  return s.map((p) => ({ date: p.date, value: r(p.value, d) }));
}

export function buildSharePayload(
  src: ShareSource,
  incognito: boolean,
  live = false,
): SharePayload {
  const total = src.netWorth || 0;
  return {
    v: 2,
    incognito,
    live,
    ownerName: src.ownerName,
    portfolioIds: src.portfolioIds,
    currency: src.currency,
    createdAt: new Date().toISOString(),
    netWorth: incognito ? null : r(total, 2),
    irr: src.irr != null ? r(src.irr, 4) : null,
    twr: src.twr != null ? r(src.twr, 4) : null,
    twrSeries: roundSeries(src.twrSeries, 4),
    wealthSeries: incognito ? null : roundSeries(src.wealthSeries, 2),
    holdings: src.holdings.map((h) => ({
      name: h.name,
      type: h.type,
      allocation: r(total > 0 ? h.marketValue / total : 0, 4),
      ret: r(h.ret, 4),
      value: incognito ? null : r(h.marketValue, 2),
    })),
  };
}

/** Base64url-encode a payload for the URL-fragment fallback. */
export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(fragment: string): SharePayload | null {
  try {
    const b64 = fragment.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    return normalizeShare(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Validate/normalise an arbitrary object into a SharePayload, or null. */
export function normalizeShare(p: unknown): SharePayload | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Partial<SharePayload>;
  if (!Array.isArray(o.holdings) || !Array.isArray(o.twrSeries)) return null;
  return o as SharePayload;
}

/**
 * Validate an optional share link expiry. `undefined`/`null` (not provided)
 * means "never expires" → `null`. A provided value must be a parseable date
 * strictly in the future → returned as an ISO string to store. Anything else
 * (unparseable, not in the future) is invalid → `undefined`, which callers
 * should reject with a 400.
 */
export function validateExpiresAt(input: unknown, now: Date = new Date()): string | null | undefined {
  if (input == null) return null;
  if (typeof input !== "string") return undefined;
  const t = Date.parse(input);
  if (Number.isNaN(t) || t <= now.getTime()) return undefined;
  return new Date(t).toISOString();
}
