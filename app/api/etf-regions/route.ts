// An ETF's geographic (region) breakdown by ISIN. Used by the Analysis "Region"
// pie so a fund contributes its real geographic spread. Keyless — sourced from
// onvista's fund country breakdown; the client falls back to the constituent
// look-through when a fund isn't found there.

import { fetchEtfRegionWeights } from "@/lib/server/classify";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ found: false });

  const regions = await fetchEtfRegionWeights(q);
  if (!regions) return Response.json({ found: false });

  return Response.json({ found: true, regions });
}
