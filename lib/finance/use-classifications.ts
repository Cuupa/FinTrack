"use client";

// Online-enriches sector/region classifications for directly-held stocks that
// the catalog doesn't classify (e.g. custom assets), via /api/classify. ETF
// constituents are classified in the DB, so they don't need this.

import { useEffect, useMemo, useState } from "react";
import { assetPriceKey } from "../types";
import { lookupInstrument } from "../catalog/catalog";
import type { HoldingSummary } from "./portfolio";
import type { ClassMap } from "./allocation";

export function useClassifications(
  holdings: HoldingSummary[],
  version: number,
): ClassMap {
  const [map, setMap] = useState<ClassMap>({});

  // Direct stocks with no catalog classification.
  const needed = useMemo(() => {
    const out: { key: string; q: string }[] = [];
    for (const h of holdings) {
      if (h.asset.type !== "STOCK") continue;
      const key = assetPriceKey(h.asset);
      const inst = lookupInstrument(key);
      if (inst?.sector || inst?.region) continue;
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
            const res = await fetch(`/api/classify?q=${encodeURIComponent(n.q)}`);
            if (!res.ok) return null;
            const d = (await res.json()) as {
              found?: boolean;
              sector?: string | null;
              region?: string | null;
            };
            if (d.found) return [n.key, { sector: d.sector, region: d.region }] as const;
          } catch {
            /* ignore */
          }
          return null;
        }),
      );
      if (cancelled) return;
      const add: ClassMap = {};
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
