// Price provider + quote/currency resolution.
//
// The asset catalog (known instruments + provider quote symbols) lives in the
// database and is mirrored into lib/catalog at startup; this module reads that
// cache. Real current prices come from /api/quotes (keyed by the catalog's
// provider symbols); historical series and any offline gaps use a deterministic
// synthetic random walk seeded by the asset's price key.

import { assetPriceKey, type Asset, type AssetType } from "../types";
import { lookupInstrument, type Instrument, type QuoteSource } from "../catalog/catalog";
import { addDays, daysBetween, parseISODate, today } from "./dates";

export interface QuoteRef {
  source: QuoteSource;
  id: string;
  /** Native currency the provider returns (empty = base, for crypto). */
  currency: string;
}

interface Descriptor {
  basePrice: number;
  drift: number;
  vol: number;
}

/** Resolve master data by WKN, ISIN, or symbol (auto-import). */
export function lookupInstrumentByQuery(query: string): Instrument | null {
  return lookupInstrument(query);
}

// Deterministic 32-bit hash → seed.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG — deterministic given a seed.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalize(s: string): string {
  return s.trim().toUpperCase();
}

const HISTORY_START = "2014-01-01";
const seriesCache = new Map<string, number[]>();

/** Synthetic parameters for a price key: from the catalog, else from its hash. */
function descriptorFor(key: string): Descriptor {
  const inst = lookupInstrument(key);
  if (inst) return { basePrice: inst.basePrice, drift: inst.drift, vol: inst.vol };
  const k = normalize(key);
  const rand = mulberry32(hashSeed(k));
  return {
    basePrice: 20 + rand() * 480,
    drift: 0.05 + rand() * 0.1,
    vol: 0.15 + rand() * 0.4,
  };
}

/** Build (and cache) the daily synthetic series ending near basePrice. */
function buildSeries(key: string): number[] {
  const k = normalize(key);
  const cached = seriesCache.get(k);
  if (cached) return cached;

  const desc = descriptorFor(k);
  const days = Math.max(1, daysBetween(HISTORY_START, today()));
  const rand = mulberry32(hashSeed(k));
  const dailyDrift = desc.drift / 365;
  const dailyVol = desc.vol / Math.sqrt(365);

  const series = new Array<number>(days + 1);
  let logPrice = 0;
  series[0] = 1;
  for (let i = 1; i <= days; i++) {
    logPrice += dailyDrift - 0.5 * dailyVol * dailyVol + dailyVol * gaussian(rand);
    series[i] = Math.exp(logPrice);
  }
  const scale = desc.basePrice / series[days];
  for (let i = 0; i <= days; i++) series[i] = Math.max(0.01, series[i] * scale);

  seriesCache.set(k, series);
  return series;
}

/** Clear cached synthetic series (e.g. after the catalog loads). */
export function resetPriceCache(): void {
  seriesCache.clear();
}

/** Current synthetic price (native currency) for a price key. */
export function currentPrice(key: string, type: AssetType): number {
  if (type === "CASH") return 1;
  const s = buildSeries(key);
  return s[s.length - 1];
}

/** Historical synthetic price (native currency) for a price key on a date. */
export function priceOn(key: string, type: AssetType, isoDate: string): number {
  if (type === "CASH") return 1;
  const s = buildSeries(key);
  const idx = daysBetween(HISTORY_START, isoDate);
  if (idx <= 0) return s[0];
  if (idx >= s.length) return s[s.length - 1];
  return s[idx];
}

/** Full daily price history for a key (used by statistical estimation). */
export function dailyPrices(key: string): number[] {
  return buildSeries(key);
}

export function earliestPriceDate(): string {
  return HISTORY_START;
}

/** Native trading currency for an asset (falls back to the base currency). */
export function nativeCurrency(asset: Asset, base: string): string {
  if (asset.currency) return asset.currency;
  const inst = lookupInstrument(assetPriceKey(asset));
  return inst?.currency ?? base;
}

/**
 * Resolve an asset to a live-quote provider reference, or null if it can't be
 * priced live. Uses the catalog when available; otherwise (e.g. no database
 * configured) still prices equities via Yahoo by ISIN — the ISIN is enough, so
 * live prices work even without the catalog loaded. Crypto needs the catalog
 * to know its CoinGecko id.
 */
export function quoteRefFor(asset: Asset): QuoteRef | null {
  const inst =
    lookupInstrument(assetPriceKey(asset)) ??
    (asset.symbol ? lookupInstrument(asset.symbol) : null);
  if (inst?.quoteSource && inst.quoteId) {
    return { source: inst.quoteSource, id: inst.quoteId, currency: inst.currency ?? "" };
  }
  // Catalog miss: equities can still be resolved by ISIN (or symbol) on Yahoo.
  if (asset.type === "STOCK" || asset.type === "ETF") {
    if (asset.isin || asset.symbol) {
      return { source: "yahoo", id: asset.symbol ?? "", currency: asset.currency ?? "" };
    }
  }
  return null;
}

/** Build a live-quote item for an asset (for /api/quotes and /api/history). */
export function quoteItemFor(
  asset: Asset,
): { key: string; source: QuoteRef["source"]; id: string; currency: string } | null {
  const ref = quoteRefFor(asset);
  if (!ref) return null;
  return { key: assetPriceKey(asset), source: ref.source, id: ref.id, currency: ref.currency };
}

export { parseISODate, addDays };
