// An ETF's geographic (region) breakdown by ISIN or symbol. Used by the
// Analysis "Region" pie so a fund contributes its real geographic spread.
// Requires FMP_API_KEY; otherwise the client falls back to the constituent
// look-through.

import { fetchEtfRegionWeights } from "@/lib/server/classify";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ found: false });

  const regions = await fetchEtfRegionWeights(q);
  if (!regions) return Response.json({ found: false });

  return Response.json({ found: true, regions });
}
