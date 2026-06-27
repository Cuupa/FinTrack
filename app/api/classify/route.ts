// On-demand sector + region classification for an asset by ISIN or symbol, via
// Yahoo's assetProfile. Used by the client to enrich directly-held stocks the
// catalog doesn't classify. The catalog itself is backfilled by
// /api/cron/sync-classifications. Shared logic lives in lib/server/classify.ts.

import { classify } from "@/lib/server/classify";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ found: false });

  const c = await classify(q);
  if (!c) return Response.json({ found: false });

  return Response.json({ found: true, sector: c.sector, region: c.region, country: c.country });
}
