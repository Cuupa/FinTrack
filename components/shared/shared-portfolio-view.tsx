"use client";

// Read-only render of a shared portfolio snapshot: headline metrics (net worth,
// TWROR, IRR), a performance line chart (TWROR / wealth) with timeframe + a
// benchmark compare, an allocation donut, and the holdings table. Used by both
// the short-id (/shared/[id]) and fragment (/shared) routes.

import { useMemo, useState } from "react";
import Link from "next/link";
import type { SharePayload, SharePt } from "@/lib/share/share";
import { timeframeStart, today, type Timeframe } from "@/lib/finance/dates";
import { formatCurrency, formatNumber, formatPercent, plColor } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { BenchmarkPicker } from "@/components/charts/benchmark-picker";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import {
  PerformanceChart,
  type ChartMode,
} from "@/components/charts/performance-chart";
import { AllocationPie } from "@/components/allocation/allocation-pie";

const TFS: Timeframe[] = ["1M", "3M", "YTD", "1Y", "5Y", "MAX"];

/** Slice a dated series to a timeframe; optionally re-base a cumulative-return
 *  series so it restarts at 0 at the window start. */
function windowSlice(series: SharePt[], tf: Timeframe, rebaseReturn: boolean): SharePt[] {
  if (series.length === 0) return series;
  if (tf === "MAX") return series;
  const start = timeframeStart(tf, today(), series[0].date);
  const win = series.filter((p) => p.date >= start);
  if (win.length === 0) return [];
  if (!rebaseReturn) return win;
  const base = win[0].value; // cumulative return at window start
  return win.map((p) => ({ date: p.date, value: (1 + p.value) / (1 + base) - 1 }));
}

export function SharedPortfolioView({ payload }: { payload: SharePayload }) {
  const { incognito, currency, holdings, netWorth, irr, wealthSeries, twrSeries } = payload;
  const [tf, setTf] = useState<Timeframe>("1Y");
  const [mode, setMode] = useState<ChartMode>(wealthSeries ? "currency" : "percent");
  const [benchmarks, setBenchmarks] = useState<string[]>([]);
  const compare = useBenchmarkCompare(benchmarks, currency);

  const returnSlice = useMemo(() => windowSlice(twrSeries, tf, true), [twrSeries, tf]);
  const wealthSlice = useMemo(
    () => (wealthSeries ? windowSlice(wealthSeries, tf, false) : null),
    [wealthSeries, tf],
  );
  // Chart x-axis/series: wealth when available + in wealth mode, else the return
  // series. returnSeries is always the (re-based) TWROR, aligned by index.
  const chartSeries = mode === "currency" && wealthSlice ? wealthSlice : returnSlice;
  const windowTwr = returnSlice.length ? returnSlice[returnSlice.length - 1].value : null;

  const slices = holdings.map((h) => ({ label: h.name, value: h.allocation }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shared portfolio</h1>
          <p className="text-sm text-zinc-500">
            A read-only snapshot{incognito ? " (incognito — amounts hidden)" : ""}.
          </p>
        </div>
        {incognito && (
          <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700">
            Incognito
          </span>
        )}
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          {!incognito && netWorth != null && (
            <Stat label="Net worth" value={formatCurrency(netWorth, currency)} />
          )}
          <Stat
            label={`TWROR (${tf})`}
            value={windowTwr != null ? formatPercent(windowTwr) : "—"}
            valueClassName={windowTwr != null ? plColor(windowTwr) : ""}
          />
          <Stat
            label="IRR (p.a.)"
            value={irr != null ? formatPercent(irr) : "—"}
            valueClassName={irr != null ? plColor(irr) : ""}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
            {TFS.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                aria-pressed={tf === t}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  tf === t
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {wealthSeries && (
            <div className="inline-flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
              {(["currency", "percent"] as ChartMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {m === "currency" ? "Wealth" : "Return"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <BenchmarkPicker
            selected={benchmarks}
            onToggle={(id) =>
              setBenchmarks((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]))
            }
          />
        </div>

        <div className="mt-4">
          <PerformanceChart
            series={chartSeries}
            scale="linear"
            mode={mode}
            currency={currency}
            compare={compare}
            mainLabel="Portfolio"
            returnSeries={returnSlice}
          />
        </div>
      </Card>

      {slices.length > 0 && (
        <Card>
          <h2 className="mb-4 text-sm font-semibold">Allocation</h2>
          <AllocationPie slices={slices} currency={currency} />
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Holdings</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3 text-right">Allocation</th>
                <th className="py-2 pr-3 text-right">Return</th>
                {!incognito && <th className="py-2 pr-3 text-right">Value</th>}
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => (
                <tr
                  key={`${h.name}-${i}`}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                >
                  <td className="py-2 pr-3 font-medium">{h.name}</td>
                  <td className="py-2 pr-3 text-zinc-500">{h.type}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatNumber(h.allocation * 100, 1)}%
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${plColor(h.ret)}`}>
                    {formatPercent(h.ret)}
                  </td>
                  {!incognito && (
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {h.value != null ? formatCurrency(h.value, currency) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-center text-xs text-zinc-400">
        Powered by{" "}
        <Link href="/" className="hover:underline">
          FinTrack
        </Link>
      </p>
    </div>
  );
}
