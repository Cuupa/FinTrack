"use client";

// Fetches real dividend events for a set of assets (from /api/dividends). Used
// by the dashboard hero (total received) and the asset detail page. On-demand,
// not polled. Accumulating funds return an empty list.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { HistItem } from "./history";

export type DividendMap = Record<string, { date: string; amount: number }[]>;

export function useDividends(items: HistItem[], range = "10y"): DividendMap {
  const sig = useMemo(
    () => range + "|" + items.map((i) => `${i.key}:${i.source}:${i.id}:${i.currency}`).sort().join(","),
    [items, range],
  );

  const [map, setMap] = useState<DividendMap>({});

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await apiFetch("/api/dividends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range, items }),
        });
        const json = res.ok ? ((await res.json()) as { dividends?: DividendMap }) : null;
        if (!cancelled && json?.dividends) setMap(json.dividends);
      } catch {
        /* keep previous */
      }
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
