// Asset metadata lookup for auto-import, by ISIN or symbol, via Yahoo Finance.
// Lets auto-import work for any listed security even when the local catalog is
// empty (e.g. no Supabase configured). German WKNs aren't resolvable by free
// data sources — the client should fall back to manual entry / the ISIN.

import { currencyOf, isISIN, searchAssets } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

const TYPE_MAP: Record<string, "STOCK" | "ETF" | "CRYPTO"> = {
  EQUITY: "STOCK",
  ETF: "ETF",
  MUTUALFUND: "ETF",
  CRYPTOCURRENCY: "CRYPTO",
};

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ found: false });

  const matches = await searchAssets(q).catch(() => []);
  // Prefer a recognised security type; else the first match.
  const match = matches.find((m) => TYPE_MAP[m.quoteType]) ?? matches[0];
  if (!match) return Response.json({ found: false });

  const type = TYPE_MAP[match.quoteType] ?? "STOCK";
  const currency = await currencyOf(match.symbol).catch(() => null);
  const isin = isISIN(q) ? q.toUpperCase() : null;

  return Response.json({
    found: true,
    name: match.name,
    // Keep ISIN-identified securities symbol-less (priced by ISIN); for a
    // symbol query, strip any exchange suffix (AAPL.TO -> AAPL).
    symbol: isin ? null : match.symbol.split(".")[0],
    type,
    currency,
    isin,
  });
}
