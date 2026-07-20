// Announced (confirmed upcoming) dividend ex/pay dates per asset, keyed by
// price key (COMPETITION.md F4). Data comes from Yahoo's crumb-authenticated
// quoteSummary calendarEvents; a listing with no upcoming dividend on file is
// simply absent from the map, and the client falls back to its trailing
// projection. Equities only (crypto/cash never pay dividends).

import { announcedByQuery, isISIN, type AnnouncedDividend } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

interface CalItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko";
  id: string;
  currency: string;
  // Asset name — fallback Yahoo search query when the ISIN/WKN/symbol turns
  // up nothing (mirrors /api/dividends).
  name?: string;
}

interface RequestBody {
  items?: CalItem[];
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ announced: {} });
  }

  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (i) => i.source === "yahoo" || i.source === "stooq",
  );
  const announced: Record<string, AnnouncedDividend> = {};

  await Promise.all(
    items.map(async (item) => {
      const query = isISIN(item.key) ? item.key : item.id || item.key;
      const hint = item.source === "yahoo" && item.id ? item.id : undefined;
      const r = await announcedByQuery(query, hint, item.name).catch(() => null);
      if (r) announced[item.key] = r;
    }),
  );

  return Response.json({ announced });
}
