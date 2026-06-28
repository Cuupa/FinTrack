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
  currency: string;
  netWorth: number;
  irr: number | null;
  twr: number | null;
  twrSeries: SharePt[];
  wealthSeries: SharePt[];
  holdings: { name: string; type: string; marketValue: number; ret: number }[];
}

export function buildSharePayload(src: ShareSource, incognito: boolean): SharePayload {
  const total = src.netWorth || 0;
  return {
    v: 2,
    incognito,
    currency: src.currency,
    createdAt: new Date().toISOString(),
    netWorth: incognito ? null : total,
    irr: src.irr,
    twr: src.twr,
    twrSeries: src.twrSeries,
    wealthSeries: incognito ? null : src.wealthSeries,
    holdings: src.holdings.map((h) => ({
      name: h.name,
      type: h.type,
      allocation: total > 0 ? h.marketValue / total : 0,
      ret: h.ret,
      value: incognito ? null : h.marketValue,
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
