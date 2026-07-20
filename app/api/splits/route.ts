// Real stock split events per asset (keyed by price key). Equities only —
// splits have no currency, so unlike /api/dividends there is no FX
// conversion here (a split ratio is a pure number, not a monetary amount).

import { splitsByQuery, isISIN, type SplitEvent } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

interface SplitItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko";
  id: string;
  currency: string;
  // Asset name — fallback Yahoo search query when the ISIN/WKN/symbol turns
  // up nothing (some real ISINs aren't in Yahoo's search index).
  name?: string;
}

interface RequestBody {
  range?: string;
  items?: SplitItem[];
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ splits: {} });
  }

  const range = body.range || "5y";
  // Splits have no stooq/coingecko data — yahoo only. This naturally excludes
  // CRYPTO/COMMODITY without any hardcoded asset-type branching.
  const items = (Array.isArray(body.items) ? body.items : []).filter((i) => i.source === "yahoo");
  const splits: Record<string, SplitEvent[]> = {};

  await Promise.all(
    items.map(async (item) => {
      const query = isISIN(item.key) ? item.key : item.id || item.key;
      const hint = item.source === "yahoo" && item.id ? item.id : undefined;
      const r = await splitsByQuery(query, hint, range, item.name).catch(() => null);
      if (!r) return;
      splits[item.key] = r;
    }),
  );

  return Response.json({ splits });
}
