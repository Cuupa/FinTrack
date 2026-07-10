// Current price for one asset in a REQUESTED currency, for the add-asset form's
// price prefill. Resolves the listing whose currency matches (e.g. the Xetra
// EUR line of a US stock); if only a different-currency listing exists, converts
// the price via FX (Frankfurter) so the result is always in the requested
// currency. The caller keeps the user's chosen currency — we never override it.

import { after } from "next/server";
import { resolveQuote } from "@/lib/server/yahoo";
import { secretKey, supabaseSecret } from "@/lib/server/supabase-keys";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// Optional write-through: when this resolves a live quote for an identifier
// that already has a catalog row (an already-seeded/known instrument), persist
// it the same way the price-sync cron does — so the next page load already
// has a fresh instruments.last_price without waiting for the cron. Only
// updates an existing row matched by the same identifier the cron resolves by
// (isin/wkn/symbol); never inserts. Silently skipped without the secret key,
// and never awaited on the response path — a write failure here must not
// affect the price the add-asset form shows.
function writeThroughPrice(q: string, currency: string, priceValue: number): void {
  if (!secretKey()) return;
  const supabase = supabaseSecret();
  if (!supabase) return;
  const escaped = q.replace(/[,()]/g, "");
  if (!escaped) return;
  supabase
    .from("instruments")
    .update({ last_price: priceValue, price_synced_at: new Date().toISOString() })
    .or(`isin.eq.${escaped},wkn.eq.${escaped},symbol.eq.${escaped}`)
    .then(
      () => {},
      () => {},
    );
}

async function fxRate(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 1;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.[to];
      if (typeof rate === "number" && rate > 0) return rate;
    }
  } catch {
    /* fall through */
  }
  return 1;
}

export async function GET(req: Request): Promise<Response> {
  if (!(await rateLimit("price", req, 60))) return tooManyRequests();
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const currency = (url.searchParams.get("currency") || "").toUpperCase();
  // Fallback Yahoo search query (the asset's name) when `q` (ISIN/WKN/symbol)
  // turns up nothing — some real ISINs aren't in Yahoo's search index.
  const name = url.searchParams.get("name")?.trim() || undefined;
  if (!q) return Response.json({ found: false });

  const r = await resolveQuote(q, currency, undefined, name);
  if (!r) return Response.json({ found: false });

  // Convert into the requested currency when the resolved listing differs.
  let price = r.price;
  if (currency && r.currency && r.currency !== currency) {
    price = r.price * (await fxRate(r.currency, currency));
  }

  const resultCurrency = currency || r.currency;
  after(() => writeThroughPrice(q, resultCurrency, price));

  return Response.json({ found: true, price, currency: resultCurrency });
}
