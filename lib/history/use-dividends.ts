"use client";

// Fetches real dividend events for a set of assets (from /api/dividends). Used
// by the dashboard hero (total received) and the asset detail page. On-demand,
// not polled. Accumulating funds return an empty list.
//
// `loading` is DERIVED from comparing the settled state's signature against
// the current one (same pattern as lib/history/use-history.ts) rather than set
// synchronously in the effect, since Next 16's react-hooks/set-state-in-effect
// lint rule fails the build on that. Unlike useHistory, the previous map is
// always returned even while loading; callers that show stale data during a
// sig change (rather than blanking it) can do so; components that want a
// loading skeleton read `loading` explicitly.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { HistItem } from "./history";

export type DividendMap = Record<string, { date: string; amount: number }[]>;

export function useDividends(
  items: HistItem[],
  range = "10y",
): { dividends: DividendMap; loading: boolean } {
  const sig = useMemo(
    () => range + "|" + items.map((i) => `${i.key}:${i.source}:${i.id}:${i.currency}`).sort().join(","),
    [items, range],
  );

  const [state, setState] = useState<{ sig: string; map: DividendMap }>({ sig: "", map: {} });

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const run = async () => {
      let fetched: DividendMap | null = null;
      try {
        const res = await apiFetch("/api/dividends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range, items }),
        });
        const json = res.ok ? ((await res.json()) as { dividends?: DividendMap }) : null;
        fetched = json?.dividends ?? null;
      } catch {
        fetched = null;
      }
      // Settle this sig either way so `loading` clears; keep the previous map
      // on a failed/empty response instead of blanking it.
      if (!cancelled) setState((s) => ({ sig, map: fetched ?? s.map }));
    };
    const t = setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const loading = items.length > 0 && state.sig !== sig;
  return { dividends: state.map, loading };
}
