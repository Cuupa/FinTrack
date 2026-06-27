// Current price for one asset in a requested currency, for the add-asset form's
// price prefill. Resolves the listing whose currency matches (e.g. the Xetra
// EUR line of a US stock) via the shared resolver, and returns the ACTUAL
// currency of the listing it found — so the form never labels a USD price as
// EUR. Falls back to any listing with data when the requested currency has none.

import { resolveQuote } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const currency = (url.searchParams.get("currency") || "").toUpperCase();
  if (!q) return Response.json({ found: false });

  const r = await resolveQuote(q, currency);
  if (!r) return Response.json({ found: false });

  return Response.json({ found: true, price: r.price, currency: r.currency, symbol: r.symbol });
}
