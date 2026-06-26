"use client";

// Fetches real historical price series for a set of assets over a timeframe
// and caches them per (items, range). Charts fall back to the synthetic series
// for anything not returned.

import { useEffect, useMemo, useState } from "react";
import type { HistItem, HistoryMap } from "./history";

export function useHistory(
  items: HistItem[],
  range: string,
  base: string,
): { histories: HistoryMap; loading: boolean } {
  const sig = useMemo(
    () =>
      range +
      "|" +
      base +
      "|" +
      items.map((i) => `${i.key}:${i.source}:${i.id}`).sort().join(","),
    [items, range, base],
  );

  const [state, setState] = useState<{ histories: HistoryMap; loading: boolean }>({
    histories: {},
    loading: items.length > 0,
  });

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base, range, items }),
        });
        const json = res.ok ? ((await res.json()) as { histories?: HistoryMap }) : null;
        if (!cancelled) setState({ histories: json?.histories ?? {}, loading: false });
      } catch {
        if (!cancelled) setState((s) => ({ histories: s.histories, loading: false }));
      }
    };
    // Defer out of the effect body (no synchronous setState in the effect).
    const t = setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return state;
}
