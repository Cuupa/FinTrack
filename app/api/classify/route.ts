// Online classification (sector + geographic region) for an asset by ISIN or
// symbol, via Yahoo's assetProfile. Used to fill look-through classifications
// the catalog doesn't have (e.g. custom stocks). Yahoo's quoteSummary needs a
// cookie+crumb, which we fetch and cache.

import { isISIN, resolveSymbol } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ found: false });

  const symbol = isISIN(q) ? await resolveSymbol(q, "") : q;
  if (!symbol) return Response.json({ found: false });

  const profile = await assetProfile(symbol);
  if (!profile) return Response.json({ found: false });

  const sector = profile.sector ? SECTOR_MAP[profile.sector] ?? profile.sector : null;
  const region = profile.country
    ? REGION_BY_COUNTRY[profile.country] ?? "Other"
    : null;

  return Response.json({ found: true, sector, region, country: profile.country ?? null });
}
