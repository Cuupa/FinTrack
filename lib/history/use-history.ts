"use client";

// Fetches real historical price series for a set of assets over a timeframe
// and caches them per (items, range). Charts fall back to the synthetic series
// for anything not returned.
//
// Behind the "historyCache" feature flag, a browser-local
// stale-while-revalidate layer (lib/history/history-cache.ts) removes the
// visible network wait on repeat visits: a cache hit paints immediately, then
// a background fetch still runs and refreshes the state if the data changed.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useFeatureFlag } from "../flags/flags-context";
import { readHistoryCache, writeHistoryCache } from "./history-cache";
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

  const historyCacheEnabled = useFeatureFlag("historyCache");

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const run = async () => {
      // Cache hit: paint immediately (flips the derived `loading` to false),
      // then still fetch below to revalidate in the background.
      let cached: HistoryMap | null = null;
      if (historyCacheEnabled) {
        cached = readHistoryCache(sig);
        if (cached && !cancelled) setState({ sig, histories: cached });
      }
      try {
        const res = await apiFetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base, range, items }),
        });
        const json = res.ok ? ((await res.json()) as { histories?: HistoryMap }) : null;
        // A single (or zero) point isn't a usable series — drop it so the chart
        // falls back to the full synthetic line instead of a flat/blank one.
        const raw = json?.histories ?? {};
        const usable: HistoryMap = {};
        for (const [k, pts] of Object.entries(raw)) {
          if (Array.isArray(pts) && pts.length >= 2) usable[k] = pts;
        }
        if (!cancelled) {
          if (historyCacheEnabled) {
            writeHistoryCache(sig, usable);
            // Only re-render if the revalidated data actually differs from
            // what's already painted (the cache hit) - avoids a pointless
            // re-render on every visit when nothing changed.
            const unchanged = cached != null && JSON.stringify(usable) === JSON.stringify(cached);
            if (!unchanged) setState({ sig, histories: usable });
          } else {
            setState({ sig, histories: usable });
          }
        }
      } catch {
        if (!cancelled) {
          // On failure, keep a cache hit's data on screen rather than
          // blanking it; without a hit, fall back to today's behavior (mark
          // this sig done/empty so we don't spin forever).
          if (!(historyCacheEnabled && cached)) setState({ sig, histories: {} });
        }
      }
    };
    // Defer out of the effect body (no synchronous setState in the effect).
    const t = setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, historyCacheEnabled]);

  const loading = items.length > 0 && state.sig !== sig;
  // While loading, don't hand back the previous range's histories — callers that
  // ignore `loading` would otherwise mix them with the new timeframe.
  return { histories: loading ? {} : state.histories, loading };
}
