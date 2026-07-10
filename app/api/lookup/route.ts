// Asset metadata lookup for auto-import, by ISIN, WKN, or symbol. Fans out to
// multiple sources (Yahoo + onvista — see lib/server/search.ts) so it works
// even when the local catalog is empty (e.g. no Supabase configured), and —
// unlike Yahoo alone — resolves German WKNs via onvista. See
// SEARCH_DESIGN.md for the design.

import { pickBest, searchInstruments } from "@/lib/server/search";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await rateLimit("lookup", req, 30))) return tooManyRequests();
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ found: false });

  const merged = await searchInstruments(q);
  const best = pickBest(q, merged);
  if (!best) return Response.json({ found: false });

  const isCrypto = best.type === "CRYPTO";

  return Response.json({
    found: true,
    name: best.name,
    // Keep ISIN-identified securities symbol-less (priced by ISIN); crypto
    // has no ISIN in this app's model and keeps its symbol regardless.
    symbol: best.isin && !isCrypto ? null : best.symbol,
    type: best.type,
    currency: best.currency,
    isin: best.isin,
    wkn: best.wkn,
  });
}
