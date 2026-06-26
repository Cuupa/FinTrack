// Portfolio "X-ray" / look-through. Decomposes ETF holdings into their
// underlying stocks (from the DB constituents) and merges them with directly
// held stocks, so you can see your true exposure to a single company across
// several funds (e.g. how much NVIDIA you hold via an S&P 500 ETF + an MSCI
// World ETF + a direct position).

import { constituentsFor } from "../catalog/catalog";
import type { HoldingSummary } from "./portfolio";

export interface ExposureSource {
  holdingName: string;
  value: number;
  /** True when the exposure comes through a fund (vs a direct holding). */
  viaEtf: boolean;
}

export interface Exposure {
  key: string;
  name: string;
  symbol: string | null;
  isin: string | null;
  /** Look-through value in the base currency. */
  value: number;
  /** Share of the whole portfolio. */
  percent: number;
  sources: ExposureSource[];
}

export interface XrayResult {
  exposures: Exposure[];
  total: number;
  /** Value decomposed into individual stocks. */
  classified: number;
  /** ETF remainder not in the catalog + non-equity (crypto/cash). */
  unclassified: number;
}

function keyFor(isin: string | null, symbol: string | null, name: string): string {
  return (isin || symbol || name).toUpperCase();
}

/** Look through a set of holdings into per-stock exposure. */
export function xrayPortfolio(holdings: HoldingSummary[]): XrayResult {
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);
  const map = new Map<string, Exposure>();
  let unclassified = 0;

  const add = (
    name: string,
    symbol: string | null,
    isin: string | null,
    value: number,
    source: ExposureSource,
  ) => {
    if (value <= 0) return;
    const key = keyFor(isin, symbol, name);
    let e = map.get(key);
    if (!e) {
      e = { key, name, symbol, isin, value: 0, percent: 0, sources: [] };
      map.set(key, e);
    }
    e.value += value;
    e.sources.push(source);
  };

  for (const h of holdings) {
    const { asset, marketValue } = h;
    if (marketValue <= 0) continue;

    if (asset.type === "ETF") {
      const cons = constituentsFor(asset.symbol);
      if (cons.length === 0) {
        unclassified += marketValue;
        continue;
      }
      let covered = 0;
      for (const c of cons) {
        const v = marketValue * c.weight;
        covered += c.weight;
        add(c.name, c.symbol, c.isin, v, {
          holdingName: asset.name,
          value: v,
          viaEtf: true,
        });
      }
      // The part of the fund not in our (partial) constituent list.
      unclassified += marketValue * Math.max(0, 1 - covered);
    } else if (asset.type === "STOCK") {
      add(asset.name, asset.symbol, asset.isin, marketValue, {
        holdingName: asset.name,
        value: marketValue,
        viaEtf: false,
      });
    } else {
      // Crypto / cash aren't equities — not part of stock look-through.
      unclassified += marketValue;
    }
  }

  const exposures = Array.from(map.values())
    .map((e) => ({
      ...e,
      percent: total > 0 ? e.value / total : 0,
      sources: e.sources.sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);

  const classified = exposures.reduce((s, e) => s + e.value, 0);
  return { exposures, total, classified, unclassified };
}
