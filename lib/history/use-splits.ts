"use client";

// Fetches real stock split events for a set of assets (from /api/splits).
// Used by the asset detail page to detect splits the user hasn't yet booked.
// On-demand, not polled.
//
// `loading` is DERIVED from comparing the settled state's signature against
// the current one (same pattern as lib/history/use-dividends.ts) rather than
// set synchronously in the effect, since Next 16's react-hooks/set-state-in-effect
// lint rule fails the build on that. The previous map is always returned even
// while loading; components that want a loading skeleton read `loading` explicitly.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { HistItem } from "./history";

export type SplitMap = Record<string, { date: string; ratio: number }[]>;

export function useSplits(
  items: HistItem[],
  range = "5y",
): { splits: SplitMap; loading: boolean } {
  const sig = useMemo(
    () => range + "|" + items.map((i) => `${i.key}:${i.source}:${i.id}:${i.currency}`).sort().join(","),
    [items, range],
  );

  const [state, setState] = useState<{ sig: string; map: SplitMap }>({ sig: "", map: {} });

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const run = async () => {
      let fetched: SplitMap | null = null;
      try {
        const res = await apiFetch("/api/splits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range, items }),
        });
        const json = res.ok ? ((await res.json()) as { splits?: SplitMap }) : null;
        fetched = json?.splits ?? null;
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
  return { splits: state.map, loading };
}
