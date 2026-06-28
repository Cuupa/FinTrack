"use client";

// Fetches real historical price series for a set of assets over a timeframe
// and caches them per (items, range). Charts fall back to the synthetic series
// for anything not returned.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
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

  // Store the signature the cached histories belong to. `loading` is then
  // DERIVED (state.sig !== sig), so switching timeframe is immediately "loading"
  // — we never report loading:false while still holding the previous range's
  // histories (the race that showed wrong values on fast timeframe clicks).
  const [state, setState] = useState<{ sig: string; histories: HistoryMap }>({
    sig: "",
    histories: {},
  });

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await apiFetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base, range, items }),
        });
        const json = res.ok ? ((await res.json()) as { histories?: HistoryMap }) : null;
        if (!cancelled) setState({ sig, histories: json?.histories ?? {} });
      } catch {
        // Mark this sig done (empty) so we don't spin forever.
        if (!cancelled) setState({ sig, histories: {} });
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

  const loading = items.length > 0 && state.sig !== sig;
  // While loading, don't hand back the previous range's histories — callers that
  // ignore `loading` would otherwise mix them with the new timeframe.
  return { histories: loading ? {} : state.histories, loading };
}
