// Translates the fixed vocabulary of allocation-breakdown slice labels
// (lib/finance/allocation.ts) into the active locale. The finance layer is
// pure and locale-agnostic, so it always returns English canonical labels
// (asset types, sector/region names, sentinel buckets); this module maps the
// known ones to dictionary keys and passes anything else through verbatim —
// country names, investment names, and user tag values are real data, not
// vocabulary, and must never be "translated" into nonsense.

import type { MessageKey } from "./dictionaries";

const LABEL_KEYS: Record<string, MessageKey> = {
  // Asset classes (lib/finance/allocation.ts byAssetClass — raw AssetType).
  STOCK: "assetType.STOCK",
  ETF: "assetType.ETF",
  CRYPTO: "assetType.CRYPTO",
  COMMODITY: "assetType.COMMODITY",
  CASH: "assetType.CASH",

  // Sentinel buckets (byCustom, byCountry, lookThrough). "Cash" (title case,
  // the lookThrough sector/region bucket) is a distinct string from "CASH"
  // (the byAssetClass raw AssetType above) — both reuse assetType.CASH.
  Untagged: "alloc.untagged",
  Unknown: "alloc.unknown",
  Other: "common.other",
  Cash: "assetType.CASH",
  Commodities: "alloc.commodities",
  "Digital Assets": "alloc.digitalAssets",
  Crypto: "alloc.crypto",

  // Volatility bands (byVolatility).
  "Low (<15%)": "vol.low",
  "Medium (15-30%)": "vol.medium",
  "High (30-60%)": "vol.high",
  "Very high (>60%)": "vol.veryHigh",

  // Sectors: both the Yahoo raw vocabulary and the GICS-style vocabulary our
  // classifier (lib/server/classify.ts) maps it to.
  "Information Technology": "sector.informationTechnology",
  Technology: "sector.technology",
  "Consumer Discretionary": "sector.consumerDiscretionary",
  "Consumer Cyclical": "sector.consumerCyclical",
  "Consumer Defensive": "sector.consumerDefensive",
  "Consumer Staples": "sector.consumerStaples",
  Financials: "sector.financials",
  "Financial Services": "sector.financialServices",
  "Health Care": "sector.healthCare",
  Healthcare: "sector.healthcare",
  Materials: "sector.materials",
  "Basic Materials": "sector.basicMaterials",
  "Communication Services": "sector.communicationServices",
  Industrials: "sector.industrials",
  Energy: "sector.energy",
  Utilities: "sector.utilities",
  "Real Estate": "sector.realEstate",

  // Regions.
  "North America": "region.northAmerica",
  Europe: "region.europe",
  "Asia-Pacific": "region.asiaPacific",
  Asia: "region.asia",
  Japan: "region.japan",
  "Emerging Markets": "region.emergingMarkets",
  "Latin America": "region.latinAmerica",
  Africa: "region.africa",
  Oceania: "region.oceania",
  "Middle East": "region.middleEast",
  "Middle East & Africa": "region.middleEastAfrica",
  Global: "region.global",
  "Cash & other": "region.cashOther",
};

/**
 * Translate an allocation-breakdown slice label. Known canonical labels
 * (asset classes, sentinel buckets, volatility bands, sectors, regions) map
 * to their dictionary key; anything else (country names, investment names,
 * user tag values) passes through unchanged.
 */
export function translateSliceLabel(
  label: string,
  t: (key: MessageKey) => string,
): string {
  const key = LABEL_KEYS[label];
  return key ? t(key) : label;
}
