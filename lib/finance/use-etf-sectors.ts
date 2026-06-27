"use client";

// Fetches each ETF holding's full published sector breakdown (via
// /api/etf-sectors) so the Analysis "Sectors" pie shows a fund's real spread
// across sectors instead of a single classification or a sparse constituent
// look-through. Mirrors useClassifications (client-side, in-memory).

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { assetPriceKey } from "../types";
import type { HoldingSummary } from "./portfolio";
import type { SectorWeightsMap } from "./allocation";

export function useEtfSectors(
  holdings: HoldingSummary[],
  version: number,
): SectorWeightsMap {
  const [map, setMap] = useState<SectorWeightsMap>({});

  const needed = useMemo(() => {
    const out: { key: string; q: string }[] = [];
    for (const h of holdings) {
      if (h.asset.type !== "ETF") continue;
      const key = assetPriceKey(h.asset);
      const q = h.asset.isin || h.asset.symbol;
      if (q) out.push({ key, q });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, version]);

  const sig = useMemo(() => needed.map((n) => n.key).sort().join(","), [needed]);

  useEffect(() => {
    if (needed.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const results = await Promise.all(
        needed.map(async (n) => {
          try {
            const res = await apiFetch(`/api/fund/sector/${encodeURIComponent(n.q)}`);
            if (!res.ok) return null;
            const d = (await res.json()) as {
              found?: boolean;
              sectors?: { sector: string; weight: number }[];
            };
            if (d.found && Array.isArray(d.sectors)) return [n.key, d.sectors] as const;
          } catch {
            /* ignore */
          }
          return null;
        }),
      );
      if (cancelled) return;
      const add: SectorWeightsMap = {};
      for (const r of results) if (r) add[r[0]] = r[1];
      if (Object.keys(add).length > 0) setMap((prev) => ({ ...prev, ...add }));
    };
    const t = setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return map;
}
