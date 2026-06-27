// In-memory mirror of the `instruments` catalog (DB source of truth). Loaded
// once at startup from /api/catalog, then read synchronously by the pricing
// code. Until loaded it's empty, and unknown assets fall back to synthetic
// pricing — the app never blocks on it.

import type { AssetType } from "../types";
import { decodeEntities } from "../format";

export type QuoteSource = "yahoo" | "stooq" | "coingecko";

export interface Instrument {
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: AssetType;
  /** Native trading currency; null = portfolio base currency. */
  currency: string | null;
  /** Country / region (for allocation breakdowns). */
  country: string | null;
  /** GICS-style sector (e.g. "Information Technology"). */
  sector: string | null;
  /** Geographic region (e.g. "North America", "Europe", "Crypto"). */
  region: string | null;
  quoteSource: QuoteSource | null;
  quoteId: string | null;
  // Synthetic-price fallback parameters.
  basePrice: number;
  drift: number;
  vol: number;
  /** Annual dividend yield (fraction); sourced from the DB, not code. */
  dividendYield: number;
  /** Live price cached by the cron job (native currency), or null. */
  lastPrice: number | null;
  priceSyncedAt: string | null;
}

/** A stock held inside an ETF/fund, for look-through analysis. */
export interface Constituent {
  etfSymbol: string;
  name: string;
  symbol: string | null;
  isin: string | null;
  /** Fraction of the fund (0..1). */
  weight: number;
  sector: string | null;
  region: string | null;
}

let catalog: Instrument[] = [];
const index = new Map<string, Instrument>();
let constituents: Constituent[] = [];
const constituentsByEtf = new Map<string, Constituent[]>();
// FX rates anchored to EUR: units of `currency` per 1 EUR (cron-cached).
let fxRates: Record<string, number> = {};

function norm(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.trim().toUpperCase();
  return v || null;
}

/** Replace the catalog and rebuild the lookup index. */
export function setCatalog(items: Instrument[]): void {
  catalog = items.map((i) => ({ ...i, name: decodeEntities(i.name) }));
  index.clear();
  for (const inst of catalog) {
    for (const k of [norm(inst.isin), norm(inst.wkn), norm(inst.symbol)]) {
      if (k && !index.has(k)) index.set(k, inst);
    }
  }
}

/** Resolve an instrument by WKN, ISIN, or symbol. */
export function lookupInstrument(query: string): Instrument | null {
  const k = norm(query);
  return k ? index.get(k) ?? null : null;
}

export function allInstruments(): Instrument[] {
  return catalog;
}

export function catalogSize(): number {
  return catalog.length;
}

/** Replace the ETF constituents and rebuild the per-ETF index. */
export function setConstituents(items: Constituent[]): void {
  constituents = items.map((c) => ({ ...c, name: decodeEntities(c.name) }));
  constituentsByEtf.clear();
  for (const c of constituents) {
    const k = norm(c.etfSymbol);
    if (!k) continue;
    const list = constituentsByEtf.get(k);
    if (list) list.push(c);
    else constituentsByEtf.set(k, [c]);
  }
}

/** Constituents of an ETF/fund by its symbol (empty if none/unknown). */
export function constituentsFor(symbol: string | null | undefined): Constituent[] {
  const k = norm(symbol);
  return k ? constituentsByEtf.get(k) ?? [] : [];
}

export function hasConstituents(): boolean {
  return constituents.length > 0;
}

/** Replace the cached EUR-anchored FX rates (units of currency per 1 EUR). */
export function setFxRates(rates: Record<string, number>): void {
  fxRates = rates;
}

/**
 * Conversion rates to `base`: 1 unit of currency C in `base` = perEur[base] /
 * perEur[C]. Returns {} when rates aren't loaded.
 */
export function fxToBase(base: string): Record<string, number> {
  const perEurBase = fxRates[base.toUpperCase()];
  if (!perEurBase) return {};
  const out: Record<string, number> = {};
  for (const [cur, perEur] of Object.entries(fxRates)) {
    if (perEur > 0) out[cur] = perEurBase / perEur;
  }
  return out;
}
