// Shared server-side classification: sector + geographic region for an asset by
// ISIN or symbol, via Yahoo's assetProfile (quoteSummary needs a cookie+crumb,
// which we fetch and cache). Used by /api/classify (on-demand, for direct
// holdings) and /api/cron/sync-classifications (backfills the catalog).

import { isISIN, resolveSymbol } from "./yahoo";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// Yahoo sector → GICS-style sector.
const SECTOR_MAP: Record<string, string> = {
  Technology: "Information Technology",
  Healthcare: "Health Care",
  "Financial Services": "Financials",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Communication Services": "Communication Services",
  Industrials: "Industrials",
  Energy: "Energy",
  "Basic Materials": "Materials",
  Utilities: "Utilities",
  "Real Estate": "Real Estate",
};

// Country → geographic region.
const REGION_BY_COUNTRY: Record<string, string> = {
  "United States": "North America",
  Canada: "North America",
  Mexico: "North America",
  Germany: "Europe",
  France: "Europe",
  "United Kingdom": "Europe",
  Switzerland: "Europe",
  Netherlands: "Europe",
  Italy: "Europe",
  Spain: "Europe",
  Sweden: "Europe",
  Ireland: "Europe",
  Denmark: "Europe",
  Finland: "Europe",
  Norway: "Europe",
  Belgium: "Europe",
  China: "Asia-Pacific",
  Japan: "Asia-Pacific",
  "South Korea": "Asia-Pacific",
  Taiwan: "Asia-Pacific",
  "Hong Kong": "Asia-Pacific",
  India: "Asia-Pacific",
  Australia: "Asia-Pacific",
  Singapore: "Asia-Pacific",
  Brazil: "Latin America",
};

let crumbCache: { cookie: string; crumb: string } | null = null;

async function getCrumb(): Promise<{ cookie: string; crumb: string } | null> {
  if (crumbCache) return crumbCache;
  try {
    const res = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) return null;
    const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
      signal: AbortSignal.timeout(8000),
    });
    if (!cr.ok) return null;
    const crumb = (await cr.text()).trim();
    if (!crumb || crumb.includes("<")) return null;
    crumbCache = { cookie, crumb };
    return crumbCache;
  } catch {
    return null;
  }
}

async function assetProfile(
  symbol: string,
): Promise<{ sector: string | null; country: string | null } | null> {
  const c = await getCrumb();
  if (!c) return null;
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile&crumb=${encodeURIComponent(c.crumb)}`,
      { headers: { "User-Agent": UA, Cookie: c.cookie }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      crumbCache = null; // crumb may be stale; force refresh next time
      return null;
    }
    const data = (await res.json()) as {
      quoteSummary?: { result?: Array<{ assetProfile?: { sector?: string; country?: string } }> };
    };
    const p = data.quoteSummary?.result?.[0]?.assetProfile;
    if (!p) return null;
    return { sector: p.sector ?? null, country: p.country ?? null };
  } catch {
    return null;
  }
}

// Yahoo ETF sector key → GICS-style sector label.
const ETF_SECTOR_MAP: Record<string, string> = {
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Discretionary",
  basic_materials: "Materials",
  consumer_defensive: "Consumer Staples",
  technology: "Information Technology",
  communication_services: "Communication Services",
  financial_services: "Financials",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Health Care",
};

export interface SectorWeight {
  sector: string;
  weight: number;
}

/**
 * An ETF's full sector breakdown (the fund's published sector weightings), so a
 * fund shows ALL its sectors rather than a single bogus classification. Via
 * Yahoo's `topHoldings` module; null when unavailable (caller falls back to the
 * constituent look-through).
 */
export async function fetchEtfSectorWeights(query: string): Promise<SectorWeight[] | null> {
  const q = query.trim();
  if (!q) return null;
  const symbol = isISIN(q) ? await resolveSymbol(q, "") : q;
  if (!symbol) return null;

  const c = await getCrumb();
  if (!c) return null;
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=topHoldings&crumb=${encodeURIComponent(c.crumb)}`,
      { headers: { "User-Agent": UA, Cookie: c.cookie }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      crumbCache = null;
      return null;
    }
    const data = (await res.json()) as {
      quoteSummary?: {
        result?: Array<{
          topHoldings?: { sectorWeightings?: Array<Record<string, number | { raw?: number }>> };
        }>;
      };
    };
    const weightings = data.quoteSummary?.result?.[0]?.topHoldings?.sectorWeightings;
    if (!weightings || weightings.length === 0) return null;

    const out: SectorWeight[] = [];
    for (const entry of weightings) {
      for (const [key, val] of Object.entries(entry)) {
        const weight = typeof val === "number" ? val : (val?.raw ?? 0);
        const sector = ETF_SECTOR_MAP[key];
        if (sector && weight > 0) out.push({ sector, weight });
      }
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export interface Classification {
  sector: string | null;
  region: string | null;
  country: string | null;
}

/** Classify an asset (sector + region) by ISIN or symbol, or null if unknown. */
export async function classify(query: string): Promise<Classification | null> {
  const q = query.trim();
  if (!q) return null;
  const symbol = isISIN(q) ? await resolveSymbol(q, "") : q;
  if (!symbol) return null;

  const profile = await assetProfile(symbol);
  if (!profile) return null;

  const sector = profile.sector ? SECTOR_MAP[profile.sector] ?? profile.sector : null;
  const region = profile.country ? REGION_BY_COUNTRY[profile.country] ?? "Other" : null;
  return { sector, region, country: profile.country ?? null };
}
