"use client";

// Fetches each ETF holding's geographic region breakdown (via /api/etf-regions)
// for the Analysis "Region" pie. Mirrors useEtfSectors. Empty when the source
// (FMP) isn't configured — byRegion then falls back to constituent regions.

import { useEffect, useMemo, useState } from "react";
import { assetPriceKey } from "../types";
import type { HoldingSummary } from "./portfolio";
import type { RegionWeightsMap } from "./allocation";

export function useEtfRegions(
  holdings: HoldingSummary[],
  version: number,
): RegionWeightsMap {
  const [map, setMap] = useState<RegionWeightsMap>({});

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
            const res = await fetch(`/api/etf-regions?q=${encodeURIComponent(n.q)}`);
            if (!res.ok) return null;
            const d = (await res.json()) as {
              found?: boolean;
              regions?: { region: string; weight: number }[];
            };
            if (d.found && Array.isArray(d.regions)) return [n.key, d.regions] as const;
          } catch {
            /* ignore */
          }
          return null;
        }),
      );
      if (cancelled) return;
      const add: RegionWeightsMap = {};
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
