"use client";

// Provides selected benchmarks as CompareSeries for PerformanceChart, reading
// from the DB-backed /api/benchmarks cache (Yahoo is only hit server-side when
// the cache is stale). Fetched benchmarks are memoised so toggling doesn't
// refetch.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { BENCHMARKS } from "@/lib/finance/benchmarks";
import type { CompareSeries } from "./performance-chart";

type Hist = Record<string, { date: string; close: number }[]>;

export function useBenchmarkCompare(selected: string[]): CompareSeries[] {
  const [hist, setHist] = useState<Hist>({});

  // Only fetch ids we don't already have.
  const missing = useMemo(
    () => selected.filter((id) => !(id in hist)),
    [selected, hist],
  );
  const missingKey = useMemo(() => [...missing].sort().join(","), [missing]);

  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    apiFetch(`/api/benchmarks?ids=${encodeURIComponent(missing.join(","))}`)
      .then((r) => (r.ok ? r.json() : { benchmarks: {} }))
      .then((d: { benchmarks?: Hist }) => {
        if (!cancelled && d.benchmarks) setHist((prev) => ({ ...prev, ...d.benchmarks }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);

  return useMemo(
    () =>
      BENCHMARKS.filter((b) => selected.includes(b.id)).map((b) => ({
        label: b.label,
        color: b.color,
        points: (hist[b.id] ?? []).map((p) => ({ date: p.date, value: p.close })),
      })),
    [selected, hist],
  );
}
