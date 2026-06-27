// Real dividend events per asset (keyed by price key), in each item's currency.
// Replaces synthetic dividends: an accumulating ETF returns an empty list (no
// payouts), so the UI stops showing phantom dividends. Equities only — crypto
// and cash never pay dividends.

import { dividendsByQuery, isISIN, type DividendEvent } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

interface DivItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko";
  id: string;
  currency: string;
}

interface RequestBody {
  range?: string;
  items?: DivItem[];
}

const fxCache = new Map<string, number>();
async function fxRate(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 1;
  const ck = `${from}|${to}`;
  const cached = fxCache.get(ck);
  if (cached) return cached;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.[to];
      if (typeof rate === "number" && rate > 0) {
        fxCache.set(ck, rate);
        return rate;
      }
    }
  } catch {
    /* fall through */
  }
  return 1;
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ dividends: {} });
  }

  const range = body.range || "10y";
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (i) => i.source === "yahoo" || i.source === "stooq",
  );
  const dividends: Record<string, DividendEvent[]> = {};

  await Promise.all(
    items.map(async (item) => {
      const query = isISIN(item.key) ? item.key : item.id || item.key;
      const hint = item.source === "yahoo" && item.id ? item.id : undefined;
      const want = (item.currency || "").toUpperCase();
      const r = await dividendsByQuery(query, want, hint, range).catch(() => null);
      if (!r) return;
      let events = r.events;
      if (want && r.currency && r.currency !== want && events.length > 0) {
        const rate = await fxRate(r.currency, want);
        if (rate !== 1) events = events.map((e) => ({ date: e.date, amount: e.amount * rate }));
      }
      dividends[item.key] = events;
    }),
  );

  return Response.json({ dividends });
}
