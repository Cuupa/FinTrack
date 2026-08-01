"use client";

// Read-only render of a shared portfolio snapshot: headline metrics (net worth,
// TWROR, IRR), a performance line chart (TWROR / wealth) with timeframe + a
// benchmark compare, an allocation donut, and the holdings table. Used by both
// the short-id (/shared/[id]) and fragment (/shared) routes.

import { useMemo, useState } from "react";
import Link from "next/link";
import type { SharePayload, SharePt } from "@/lib/share/share";
import { timeframeStart, today, type Timeframe } from "@/lib/finance/dates";
import { useI18n } from "@/lib/i18n/i18n-context";
import {
  Table,
  TablePagination,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  usePagination,
} from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { formatCurrency, formatDate, formatNumber, formatPercent, plColor } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { BenchmarkPicker } from "@/components/charts/benchmark-picker";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import {
  PerformanceChart,
  type ChartMode,
} from "@/components/charts/performance-chart";
import { AllocationPie } from "@/components/allocation/allocation-pie";
import { BENCHMARKS, buildCustomBenchmark, type Benchmark } from "@/lib/finance/benchmarks";
import { resolveInstrumentByQuery } from "@/lib/import/resolve-instrument";

const TFS: Timeframe[] = ["1M", "3M", "YTD", "1Y", "5Y", "MAX"];

type HoldingSortKey = "name" | "type" | "allocation" | "ret" | "value";

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

/** "Simon's Portfolio" (handles names ending in s), else "Shared portfolio". */
function shareTitle(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "Shared portfolio";
  return `${n}${/s$/i.test(n) ? "'" : "'s"} Portfolio`;
}

export function SharedPortfolioView({ payload }: { payload: SharePayload }) {
  const { t } = useI18n(); // also re-formats figures on language change
  const { incognito, currency, holdings, netWorth, irr, wealthSeries, twrSeries } = payload;
  const [tf, setTf] = useState<Timeframe>("1Y");
  const [mode, setMode] = useState<ChartMode>(wealthSeries ? "currency" : "percent");
  const [benchmarks, setBenchmarks] = useState<string[]>([]);
  const [customBenchmarks, setCustomBenchmarks] = useState<Benchmark[]>([]);
  const compare = useBenchmarkCompare(benchmarks, currency, customBenchmarks);
  const addCustomBenchmark = async (query: string) => {
    const master = await resolveInstrumentByQuery(query);
    if (!master) return { ok: false, error: t("benchmark.notFound") };
    const b = buildCustomBenchmark(master, [...BENCHMARKS, ...customBenchmarks]);
    if (!b) return { ok: false, error: t("benchmark.alreadyAdded") };
    setCustomBenchmarks((c) => [...c, b]);
    setBenchmarks((sel) => (sel.includes(b.id) ? sel : [...sel, b.id]));
    return { ok: true };
  };
  const removeCustomBenchmark = (id: string) => {
    setCustomBenchmarks((c) => c.filter((b) => b.id !== id));
    setBenchmarks((sel) => sel.filter((x) => x !== id));
  };

  const returnSlice = useMemo(() => windowSlice(twrSeries, tf, true), [twrSeries, tf]);
  const wealthSlice = useMemo(
    () => (wealthSeries ? windowSlice(wealthSeries, tf, false) : null),
    [wealthSeries, tf],
  );
  // Chart x-axis/series: wealth when available + in wealth mode, else the return
  // series. returnSeries is always the (re-based) TWROR, aligned by index.
  const chartSeries = mode === "currency" && wealthSlice ? wealthSlice : returnSlice;
  const windowTwr = returnSlice.length ? returnSlice[returnSlice.length - 1].value : null;

  // Use absolute values when available (so the donut centre shows the real
  // total); incognito has only weights, so the currency total is hidden.
  const slices = holdings.map((h) => ({
    label: h.name,
    value: !incognito && h.value != null ? h.value : h.allocation,
  }));

  // Sortable holdings table.
  const sort = useSort<HoldingSortKey>("allocation", "desc");
  const sortedHoldings = useMemo(
    () =>
      sort.apply(holdings, (h, key) => {
        switch (key) {
          case "name":
            return h.name;
          case "type":
            return h.type;
          case "ret":
            return h.ret;
          case "value":
            return h.value ?? 0;
          case "allocation":
            return h.allocation;
        }
      }),
    [holdings, sort],
  );
  const pager = usePagination(sortedHoldings);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{shareTitle(payload.ownerName)}</h1>
          <p className="text-sm text-zinc-500">
            A read-only {payload.live ? "live view" : "snapshot"}
            {incognito ? " (incognito, amounts hidden)" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700">
            {payload.live ? "Live" : "Snapshot"}
          </span>
          {incognito && (
            <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700">
              Incognito
            </span>
          )}
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          {!incognito && netWorth != null && (
            <Stat
              label={t("stat.netWorth")}
              value={formatCurrency(netWorth, currency)}
              info="Total current value of all holdings, in the portfolio's base currency."
            />
          )}
          <Stat
            label={`TWROR (${tf})`}
            value={windowTwr != null ? formatPercent(windowTwr) : "—"}
            valueClassName={windowTwr != null ? plColor(windowTwr) : ""}
            info="Time-weighted rate of return over the selected timeframe: performance with deposits/withdrawals removed (comparable to a fund/benchmark)."
          />
          <Stat
            label="IRR (p.a.)"
            value={irr != null ? formatPercent(irr) : "—"}
            valueClassName={irr != null ? plColor(irr) : ""}
            info="Annualised, money-weighted return that accounts for the timing and size of every buy and sell."
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
            {TFS.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                aria-pressed={tf === t}
                className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
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
            <div className="inline-flex gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
              {(["currency", "percent"] as ChartMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
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
            custom={customBenchmarks}
            onAddCustom={addCustomBenchmark}
            onRemoveCustom={removeCustomBenchmark}
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
            ariaLabel={t("chart.sharedPortfolio.ariaLabel", {
              timeframe: tf,
              start: chartSeries[0] ? formatDate(chartSeries[0].date) : "",
              end: chartSeries.length ? formatDate(chartSeries[chartSeries.length - 1].date) : "",
              startValue:
                mode === "currency" && chartSeries[0]
                  ? formatCurrency(chartSeries[0].value, currency)
                  : chartSeries[0]
                    ? formatPercent(chartSeries[0].value)
                    : "",
              endValue:
                mode === "currency" && chartSeries.length
                  ? formatCurrency(chartSeries[chartSeries.length - 1].value, currency)
                  : chartSeries.length
                    ? formatPercent(chartSeries[chartSeries.length - 1].value)
                    : "",
            })}
          />
        </div>
      </Card>

      {slices.length > 0 && (
        <Card>
          <h2 className="mb-4 flex items-center gap-1.5 text-sm font-semibold">
            Allocation
            <InfoTip text={t("shared.allocationTip")} />
          </h2>
          <AllocationPie slices={slices} currency={currency} showTotal={!incognito} title="Allocation" />
        </Card>
      )}

      <Card>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          Holdings
          <InfoTip text={t("shared.holdingsTip")} />
        </h2>
        <div className="mt-3">
          <Table>
            <Thead>
              <Th sort={sort.sort} sortKey="name" onSort={sort.toggle}>
                Name
              </Th>
              <Th sort={sort.sort} sortKey="type" onSort={sort.toggle}>
                Type
              </Th>
              <Th align="right" sort={sort.sort} sortKey="allocation" onSort={sort.toggle}>
                Allocation
              </Th>
              <Th align="right" sort={sort.sort} sortKey="ret" onSort={sort.toggle}>
                Return
              </Th>
              {!incognito && (
                <Th align="right" sort={sort.sort} sortKey="value" onSort={sort.toggle}>
                  Value
                </Th>
              )}
            </Thead>
            <Tbody>
              {pager.rows.map((h, i) => (
                <Tr key={`${h.name}-${i}`}>
                  <Td className="font-medium">{h.name}</Td>
                  <Td className="text-zinc-500">{h.type}</Td>
                  <Td align="right" className="tabular-nums">
                    {formatNumber(h.allocation * 100, 1)}%
                  </Td>
                  <Td align="right" className={`tabular-nums ${plColor(h.ret)}`}>
                    {formatPercent(h.ret)}
                  </Td>
                  {!incognito && (
                    <Td align="right" className="tabular-nums">
                      {h.value != null ? formatCurrency(h.value, currency) : "—"}
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
          <TablePagination pager={pager} />
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
