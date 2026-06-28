// Shareable portfolio snapshots encoded entirely in a URL fragment (no backend,
// no server storage). A "full" share carries absolute values; an "incognito"
// share carries ONLY relative data (allocations + returns) — there are no
// absolute figures in the payload, so the recipient cannot reveal or
// reverse-engineer them. The fragment is never sent to a server.

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
  v: 1;
  incognito: boolean;
  currency: string;
  createdAt: string;
  /** Net worth in base currency, or null in incognito shares. */
  netWorth: number | null;
  holdings: ShareHolding[];
}

export interface ShareSource {
  currency: string;
  netWorth: number;
  holdings: { name: string; type: string; marketValue: number; ret: number }[];
}

export function buildSharePayload(src: ShareSource, incognito: boolean): SharePayload {
  const total = src.netWorth || 0;
  return {
    v: 1,
    incognito,
    currency: src.currency,
    createdAt: new Date().toISOString(),
    netWorth: incognito ? null : total,
    holdings: src.holdings.map((h) => ({
      name: h.name,
      type: h.type,
      allocation: total > 0 ? h.marketValue / total : 0,
      ret: h.ret,
      value: incognito ? null : h.marketValue,
    })),
  };
}

/** Base64url-encode a payload for use in a URL fragment. */
export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(fragment: string): SharePayload | null {
  try {
    const b64 = fragment.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const p = JSON.parse(json) as SharePayload;
    if (p && p.v === 1 && Array.isArray(p.holdings)) return p;
  } catch {
    /* malformed */
  }
  return null;
}
