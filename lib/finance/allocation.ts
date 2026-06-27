// Portfolio allocation breakdowns for the pie charts: distribution by
// investment, asset class, currency, country, and volatility band. All values
// are in the base currency (so cross-currency holdings are comparable).

import { assetPriceKey } from "../types";
import { constituentsFor, lookupInstrument } from "../catalog/catalog";
import type { HoldingSummary } from "./portfolio";

export interface Slice {
  label: string;
  value: number;
}

/** Online-fetched classifications keyed by assetPriceKey (for custom stocks). */
export type ClassMap = Record<string, { sector?: string | null; region?: string | null }>;

/** Online-fetched ETF sector weightings keyed by assetPriceKey. */
export type SectorWeightsMap = Record<string, { sector: string; weight: number }[]>;

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

/**
 * Look-through allocation by a classification field (sector or region): ETFs
 * are decomposed into their constituent stocks (each carrying a classification),
 * direct stocks use the instrument's (or online-fetched) classification. Both
 * the uncovered remainder of each ETF and any unclassified holding fall into a
 * single "Other" bucket (there's no separate "Unknown" — they're the same to a
 * reader).
 */
function lookThrough(
  holdings: HoldingSummary[],
  field: "sector" | "region",
  overrides?: ClassMap,
  etfSectors?: SectorWeightsMap,
): Slice[] {
  const map = new Map<string, number>();
  let other = 0;
  const add = (label: string | null | undefined, v: number) => {
    if (label) map.set(label, (map.get(label) ?? 0) + v);
    else other += v; // unclassified → "Other"
  };

  for (const h of holdings) {
    if (h.marketValue <= 0) continue;
    const type = h.asset.type;

    if (type === "ETF") {
      // Prefer the fund's published sector weightings (full breakdown); fall
      // back to the constituent look-through when unavailable.
      const weights = field === "sector" ? etfSectors?.[assetPriceKey(h.asset)] : undefined;
      if (weights && weights.length > 0) {
        let covered = 0;
        for (const w of weights) {
          covered += w.weight;
          add(w.sector, h.marketValue * w.weight);
        }
        other += h.marketValue * Math.max(0, 1 - covered);
        continue;
      }
      const cons = constituentsFor(h.asset.symbol);
      if (cons.length === 0) {
        other += h.marketValue;
        continue;
      }
      let covered = 0;
      for (const c of cons) {
        covered += c.weight;
        add(c[field], h.marketValue * c.weight);
      }
      other += h.marketValue * Math.max(0, 1 - covered);
    } else if (type === "STOCK") {
      const key = assetPriceKey(h.asset);
      const inst = lookupInstrument(key);
      add(inst?.[field] || overrides?.[key]?.[field], h.marketValue);
    } else if (type === "CRYPTO") {
      add(field === "region" ? "Crypto" : "Digital Assets", h.marketValue);
    } else {
      add("Cash", h.marketValue);
    }
  }

  if (other > 0) add("Other", other);
  return Array.from(map, ([label, value]) => ({ label, value })).sort(
    (a, b) => b.value - a.value,
  );
}

/**
 * Geographic region breakdown. ETFs are looked through to their constituents'
 * regions; direct stocks use their own. Crypto/cash (no geography) and any
 * still-unclassified holding are excluded, so the chart shows only real regions
 * (no "Other"/"Crypto") — normalised across what IS classified. Region data is
 * filled by the classification sync; without it this is empty.
 */
export function byRegion(holdings: HoldingSummary[], overrides?: ClassMap): Slice[] {
  const map = new Map<string, number>();
  const add = (label: string | null | undefined, v: number) => {
    if (label) map.set(label, (map.get(label) ?? 0) + v);
  };
  for (const h of holdings) {
    if (h.marketValue <= 0) continue;
    if (h.asset.type === "ETF") {
      for (const c of constituentsFor(h.asset.symbol)) add(c.region, h.marketValue * c.weight);
    } else if (h.asset.type === "STOCK") {
      const key = assetPriceKey(h.asset);
      add(lookupInstrument(key)?.region || overrides?.[key]?.region, h.marketValue);
    }
  }
  return Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export function bySector(
  holdings: HoldingSummary[],
  overrides?: ClassMap,
  etfSectors?: SectorWeightsMap,
): Slice[] {
  return lookThrough(holdings, "sector", overrides, etfSectors);
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
