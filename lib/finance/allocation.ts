// Portfolio allocation breakdowns for the pie charts: distribution by
// investment, asset class, currency, country, and volatility band. All values
// are in the base currency (so cross-currency holdings are comparable).

import { assetPriceKey } from "../types";
import { lookupInstrument } from "../catalog/catalog";
import type { HoldingSummary } from "./portfolio";

export interface Slice {
  label: string;
  value: number;
}

function group(
  holdings: HoldingSummary[],
  keyFn: (h: HoldingSummary) => string,
): Slice[] {
  const map = new Map<string, number>();
  for (const h of holdings) {
    if (h.marketValue <= 0) continue;
    const k = keyFn(h);
    map.set(k, (map.get(k) ?? 0) + h.marketValue);
  }
  return Array.from(map, ([label, value]) => ({ label, value })).sort(
    (a, b) => b.value - a.value,
  );
}

export function byInvestment(holdings: HoldingSummary[]): Slice[] {
  return group(holdings, (h) => h.asset.name);
}

export function byAssetClass(holdings: HoldingSummary[]): Slice[] {
  return group(holdings, (h) => h.asset.type);
}

export function byCurrency(holdings: HoldingSummary[], base: string): Slice[] {
  return group(holdings, (h) => h.currency || base);
}

export function byCountry(holdings: HoldingSummary[]): Slice[] {
  return group(holdings, (h) => {
    const inst = lookupInstrument(assetPriceKey(h.asset));
    return inst?.country ?? "Unknown";
  });
}

/** Annualised volatility for an asset, from the catalog (else a type default). */
function volForAsset(h: HoldingSummary): number {
  if (h.asset.type === "CASH") return 0;
  const inst = lookupInstrument(assetPriceKey(h.asset));
  if (inst) return inst.vol;
  return h.asset.type === "CRYPTO" ? 0.7 : h.asset.type === "ETF" ? 0.16 : 0.3;
}

export function byVolatility(holdings: HoldingSummary[]): Slice[] {
  const order = ["Low (<15%)", "Medium (15–30%)", "High (30–60%)", "Very high (>60%)"];
  const slices = group(holdings, (h) => {
    const v = volForAsset(h);
    if (v < 0.15) return order[0];
    if (v < 0.3) return order[1];
    if (v < 0.6) return order[2];
    return order[3];
  });
  // Keep a stable risk-ordered display.
  return slices.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}
