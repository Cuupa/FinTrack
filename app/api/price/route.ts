// Current price for one asset in a REQUESTED currency, for the add-asset form's
// price prefill. Resolves the listing whose currency matches (e.g. the Xetra
// EUR line of a US stock); if only a different-currency listing exists, converts
// the price via FX (Frankfurter) so the result is always in the requested
// currency. The caller keeps the user's chosen currency — we never override it.

import { resolveQuote } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

async function fxRate(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 1;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, {
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
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const currency = (url.searchParams.get("currency") || "").toUpperCase();
  if (!q) return Response.json({ found: false });

  const r = await resolveQuote(q, currency);
  if (!r) return Response.json({ found: false });

  // Convert into the requested currency when the resolved listing differs.
  let price = r.price;
  if (currency && r.currency && r.currency !== currency) {
    price = r.price * (await fxRate(r.currency, currency));
  }

  return Response.json({ found: true, price, currency: currency || r.currency });
}
