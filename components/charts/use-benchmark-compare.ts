"use client";

// Provides selected benchmarks as CompareSeries for PerformanceChart, reading
// from the DB-backed /api/benchmarks cache (Yahoo is only hit server-side when
// the cache is stale). Fetched benchmarks are memoised so toggling doesn't
// refetch.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { BENCHMARKS, type Benchmark } from "@/lib/finance/benchmarks";
import type { CompareSeries } from "./performance-chart";

type Hist = Record<string, { date: string; close: number }[]>;

export function useBenchmarkCompare(
  selected: string[],
  base: string,
  custom: Benchmark[] = [],
): CompareSeries[] {
  // Keyed by base currency so switching base refetches in the new currency.
  const [hist, setHist] = useState<Record<string, Hist>>({});
  const byBase = useMemo(() => hist[base] ?? {}, [hist, base]);

  // Only fetch curated ids we don't already have for this base currency.
  // `selected` may also carry custom ids now (handled separately below via
  // /api/history) — those must never hit /api/benchmarks.
  const missing = useMemo(
    () => selected.filter((id) => !(id in byBase) && BENCHMARKS.some((b) => b.id === id)),
    [selected, byBase],
  );
  const missingKey = useMemo(() => [...missing].sort().join(","), [missing]);

  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    apiFetch(
      `/api/benchmarks?ids=${encodeURIComponent(missing.join(","))}&base=${encodeURIComponent(base)}`,
    )
      .then((r) => (r.ok ? r.json() : { benchmarks: {} }))
      .then((d: { benchmarks?: Hist }) => {
        if (!cancelled && d.benchmarks)
          setHist((prev) => ({ ...prev, [base]: { ...prev[base], ...d.benchmarks } }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, base]);

  // Custom (user-added) benchmarks fetch real history straight from
  // /api/history (the generic proxy, any ISIN/WKN/symbol) instead of the
  // shared /api/benchmarks cache, which only ever serves the 5 curated ids.
  const [customHist, setCustomHist] = useState<Record<string, Hist>>({});
  const customByBase = useMemo(() => customHist[base] ?? {}, [customHist, base]);
  const customSelected = useMemo(
    () => custom.filter((b) => selected.includes(b.id)),
    [custom, selected],
  );
  const missingCustom = useMemo(
    () => customSelected.filter((b) => !(b.item.key in customByBase)),
    [customSelected, customByBase],
  );
  const missingCustomKey = useMemo(
    () => [...missingCustom.map((b) => b.item.key)].sort().join(","),
    [missingCustom],
  );

  useEffect(() => {
    if (missingCustom.length === 0) return;
    let cancelled = false;
    apiFetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base, range: "5Y", items: missingCustom.map((b) => b.item) }),
    })
      .then((r) => (r.ok ? r.json() : { histories: {} }))
      .then((json: { histories?: Hist }) => {
        if (!cancelled && json.histories)
          setCustomHist((prev) => ({ ...prev, [base]: { ...prev[base], ...json.histories } }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingCustomKey, base]);

  return useMemo(
    () => [
      ...BENCHMARKS.filter((b) => selected.includes(b.id)).map((b) => ({
        label: b.label,
        color: b.color,
        points: (byBase[b.id] ?? []).map((p) => ({ date: p.date, value: p.close })),
      })),
      ...customSelected.map((b) => ({
        label: b.label,
        color: b.color,
        points: (customByBase[b.item.key] ?? []).map((p) => ({ date: p.date, value: p.close })),
      })),
    ],
    [selected, byBase, customSelected, customByBase],
  );
}
