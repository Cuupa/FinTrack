// An ETF's full sector breakdown (the fund's published sector weightings) by
// ISIN or symbol, via Yahoo. Used by the Analysis "Sectors" pie so a fund
// contributes all of its sectors instead of a single classification.

import { fetchEtfSectorWeights } from "@/lib/server/classify";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ found: false });

  const sectors = await fetchEtfSectorWeights(q);
  if (!sectors) return Response.json({ found: false });

  return Response.json({ found: true, sectors });
}
