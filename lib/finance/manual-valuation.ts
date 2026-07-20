// Manual valuation registry for OTHER (manual-valuation) assets.
//
// OTHER assets (real estate, collectibles, unlisted holdings) have no market
// data source: the user enters dated valuation points and those points ARE the
// price series. This module is the PriceProvider seam's absorber for that — a
// module-level cache keyed by price key, populated once per render from
// PortfolioData (PortfolioProvider) and read synchronously by
// `lib/finance/prices.ts`, exactly mirroring how the catalog cache
// (`lib/catalog/catalog.ts`) feeds prices.ts.
//
// Pure module, no React. Points are stored ascending by date; lookups are a
// step function (carry-forward): the value on a date is the last point at or
// before it, and before the first point it's that first point's value.

import { assetPriceKey, type Asset, type ValuationPoint } from "../types";

interface ValPoint {
  date: string;
  value: number;
}

// price key (uppercased) → ascending points. Replaced wholesale on each set.
let registry = new Map<string, ValPoint[]>();

/**
 * Replace the registry from the current assets + their valuation points. Only
 * OTHER assets contribute; a price key with no usable points is omitted, so
 * `hasManualValuation` stays false until at least one point exists. Called
 * during render by the PortfolioProvider whenever assets/points change.
 */
export function setManualValuations(assets: Asset[], points: ValuationPoint[]): void {
  const keyById = new Map<string, string>();
  for (const a of assets) {
    if (a.type === "OTHER") keyById.set(a.id, assetPriceKey(a));
  }
  const next = new Map<string, ValPoint[]>();
  for (const p of points) {
    const key = keyById.get(p.assetId);
    if (!key) continue; // not an OTHER asset (or asset gone)
    if (!Number.isFinite(p.value)) continue;
    (next.get(key) ?? next.set(key, []).get(key)!).push({ date: p.date, value: p.value });
  }
  for (const arr of next.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  registry = next;
}

/** Clear all registered valuations (e.g. on sign-out / store swap). */
export function resetManualValuations(): void {
  registry = new Map();
}

/** True when this price key has at least one user-entered valuation point. */
export function hasManualValuation(key: string): boolean {
  const arr = registry.get(key.toUpperCase());
  return !!arr && arr.length > 0;
}

/** Value on `isoDate` (step/carry-forward), or null when no points exist. */
export function manualPriceOn(key: string, isoDate: string): number | null {
  const arr = registry.get(key.toUpperCase());
  if (!arr || arr.length === 0) return null;
  if (isoDate < arr[0].date) return arr[0].value;
  let lo = 0;
  let hi = arr.length - 1;
  let ans = arr[0].value;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date <= isoDate) {
      ans = arr[mid].value;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Latest entered value, or null when no points exist. */
export function manualCurrentPrice(key: string): number | null {
  const arr = registry.get(key.toUpperCase());
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1].value;
}
