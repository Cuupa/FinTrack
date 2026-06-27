"use client";

// Monte Carlo planning UI (PRD §3.3). Collects the simulation parameters,
// runs 1,000+ paths in a Web Worker, and renders the probability fan plus
// best/median/worst outcomes. Initial capital defaults to current net worth.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import {
  estimatePortfolioModel,
  portfolioOrBenchmarkStats,
  type PortfolioModel,
  type PortfolioStats,
} from "@/lib/finance/stats";
import {
  runMonteCarlo,
  runPortfolioMonteCarlo,
  type MonteCarloParams,
  type MonteCarloResult,
  type PortfolioMonteCarloParams,
} from "@/lib/finance/monte-carlo";
import { formatCurrency, formatPercent, plColor } from "@/lib/format";
import { Button, Card, Stat, SegmentedControl } from "@/components/ui/primitives";
import { DistributionChart } from "@/components/charts/distribution-chart";
import type { ChartMode, ChartScale } from "@/components/charts/performance-chart";

type SimMode = "portfolio" | "custom";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Unsigned percentage (for volatility and weights). */
function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function MonteCarloPanel() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const currency = data.profile.currency;

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation)
        .filter((h) => h.position.shares > 0)
        .map((h) => ({ asset: h.asset, marketValue: h.marketValue })),
    [data.assets, data.transactions, valuation],
  );

  const netWorth = useMemo(
    () => holdings.reduce((s, h) => s + h.marketValue, 0),
    [holdings],
  );

  // Default to simulating the real portfolio when there is one.
  const [mode, setMode] = useState<SimMode>("portfolio");

  const [form, setForm] = useState({
    monthlyContribution: 500,
    years: 30,
    runs: 1000,
  });

  // The estimation history window matches the investment horizon: a 30-year
  // horizon estimates returns/volatility from (up to) the last 30 years.
  const lookbackYears = Math.max(1, Math.round(form.years));

  // Fetch REAL historical prices for the holdings (longest available), used to
  // estimate returns/volatility; falls back to the synthetic series per asset.
  const { version } = useCatalog();
  const histItems = useMemo(
    () =>
      holdings
        .map((h) => quoteItemFor(h.asset))
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, version],
  );
  const { histories } = useHistory(histItems, "MAX", currency);

  // Aggregate portfolio statistics (single μ/σ) for the custom mode default.
  const stats = useMemo(
    () => portfolioOrBenchmarkStats(holdings, lookbackYears, histories),
    [holdings, lookbackYears, histories],
  );
  // Per-asset model (each asset's μ/σ + correlation) for the portfolio mode.
  const model = useMemo(
    () => estimatePortfolioModel(holdings, lookbackYears, histories),
    [holdings, lookbackYears, histories],
  );
  const hasPortfolio = model !== null && model.assets.length > 0;
  const effectiveMode: SimMode = hasPortfolio ? mode : "custom";
  // Estimated parameters are the defaults; overrides (if the user edits a
  // field) take precedence. Derived rather than synced via an effect.
  const [capitalOverride, setCapitalOverride] = useState<number | null>(null);
  const [returnOverride, setReturnOverride] = useState<number | null>(null);
  const [volOverride, setVolOverride] = useState<number | null>(null);

  const initialCapital =
    capitalOverride ?? (netWorth > 0 ? Math.round(netWorth) : 10000);
  const expectedReturn = returnOverride ?? round1(stats.expectedReturn * 100);
  const volatility = volOverride ?? round1(stats.volatility * 100);
  const usingEstimates = returnOverride === null && volOverride === null;

  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [scale, setScale] = useState<ChartScale>("linear");
  const [chartMode, setChartMode] = useState<ChartMode>("currency");
  const [running, setRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  function update<K extends keyof typeof form>(key: K, value: number) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetToEstimates() {
    setReturnOverride(null);
    setVolOverride(null);
  }

  function run() {
    const years = Math.max(1, Math.round(form.years));
    const runs = Math.max(1000, Math.round(form.runs));

    // Portfolio mode simulates each holding with its own μ/σ and the
    // correlation structure; custom mode uses a single μ/σ.
    const message =
      effectiveMode === "portfolio" && model
        ? {
            kind: "portfolio" as const,
            params: {
              initialCapital,
              monthlyContribution: form.monthlyContribution,
              years,
              runs,
              assets: model.assets.map((a) => ({
                weight: a.weight,
                mean: a.mean,
                vol: a.vol,
              })),
              corr: model.corr,
            } satisfies PortfolioMonteCarloParams,
          }
        : {
            kind: "scalar" as const,
            params: {
              initialCapital,
              monthlyContribution: form.monthlyContribution,
              years,
              expectedReturn: expectedReturn / 100,
              volatility: volatility / 100,
              runs,
            } satisfies MonteCarloParams,
          };

    setRunning(true);

    // Prefer a Web Worker for the "background" execution the PRD asks for, but
    // never let a worker hiccup break the feature: any failure to construct,
    // load, or respond falls back to the same pure computation on the main
    // thread. The sim is fast enough that the fallback is imperceptible.
    let settled = false;
    const finish = (r: MonteCarloResult) => {
      if (settled) return;
      settled = true;
      setResult(r);
      setRunning(false);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    const fallback = () =>
      finish(
        message.kind === "portfolio"
          ? runPortfolioMonteCarlo(message.params)
          : runMonteCarlo(message.params),
      );

    try {
      const worker = new Worker(
        new URL("../../lib/finance/monte-carlo.worker.ts", import.meta.url),
      );
      workerRef.current?.terminate();
      workerRef.current = worker;
      const watchdog = setTimeout(fallback, 4000);
      worker.onmessage = (e: MessageEvent<MonteCarloResult>) => {
        clearTimeout(watchdog);
        finish(e.data);
      };
      worker.onerror = () => {
        clearTimeout(watchdog);
        fallback();
      };
      worker.postMessage(message);
    } catch {
      fallback();
    }
  }

  const final = result?.bands[result.bands.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <h2 className="text-lg font-semibold">Parameters</h2>
        <div className="mt-4 space-y-4">
          {hasPortfolio && (
            <div>
              <label className="text-sm font-medium">Model</label>
              <div className="mt-1">
                <SegmentedControl<SimMode>
                  value={effectiveMode}
                  onChange={setMode}
                  options={[
                    { label: "My portfolio", value: "portfolio" },
                    { label: "Custom", value: "custom" },
                  ]}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {effectiveMode === "portfolio"
                  ? "Simulates each holding with its own volatility and the correlations between them."
                  : "Simulates a single blended return and volatility."}
              </p>
            </div>
          )}

          <Field
            label="Initial capital"
            suffix={currency}
            value={initialCapital}
            onChange={(v) => setCapitalOverride(v)}
          />
          <Field
            label="Monthly contribution"
            suffix={currency}
            value={form.monthlyContribution}
            onChange={(v) => update("monthlyContribution", v)}
          />
          <Field
            label="Investment horizon"
            suffix="years"
            value={form.years}
            onChange={(v) => update("years", v)}
          />

          {effectiveMode === "portfolio" && model ? (
            <PortfolioModelNote model={model} />
          ) : (
            <>
              <EstimateNote
                stats={stats}
                usingEstimates={usingEstimates}
                onReset={resetToEstimates}
              />
              <Field
                label="Expected annual return"
                suffix="%"
                value={expectedReturn}
                onChange={(v) => setReturnOverride(v)}
                step="0.1"
              />
              <Field
                label="Volatility (std. dev.)"
                suffix="%"
                value={volatility}
                onChange={(v) => setVolOverride(v)}
                step="0.1"
              />
            </>
          )}
          <Field
            label="Simulation runs"
            value={form.runs}
            onChange={(v) => update("runs", v)}
            min={1000}
            step="500"
          />
          <Button variant="primary" className="w-full" onClick={run} disabled={running}>
            {running ? "Simulating…" : "Run simulation"}
          </Button>
          <p className="text-xs text-zinc-500">
            Runs ≥ 1,000 Monte Carlo paths in the background using monthly
            compounding with normally-distributed returns.
          </p>
        </div>
      </Card>

      <div className="space-y-6 lg:col-span-2">
        {result && final ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <Stat
                  label="Median outcome"
                  value={formatCurrency(final.median, currency)}
                  sub={`after ${result.params.years} years`}
                />
              </Card>
              <Card>
                <Stat
                  label="Optimistic (90th pct)"
                  value={formatCurrency(final.p90, currency)}
                  valueClassName={plColor(1)}
                />
              </Card>
              <Card>
                <Stat
                  label="Pessimistic (10th pct)"
                  value={formatCurrency(final.p10, currency)}
                  valueClassName={plColor(-1)}
                />
              </Card>
            </div>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Projected wealth</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <SegmentedControl<ChartScale>
                    size="sm"
                    value={scale}
                    onChange={setScale}
                    options={[
                      { label: "Linear", value: "linear" },
                      { label: "Log", value: "log" },
                    ]}
                  />
                  <SegmentedControl<ChartMode>
                    size="sm"
                    value={chartMode}
                    onChange={setChartMode}
                    options={[
                      { label: "Currency", value: "currency" },
                      { label: "Percent", value: "percent" },
                    ]}
                  />
                  <span className="text-xs text-zinc-500">
                    {result.params.runs.toLocaleString()} runs
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <DistributionChart
                  result={result}
                  currency={currency}
                  scale={scale}
                  mode={chartMode}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
                <Legend color="#6366f1" opacity={0.24} label="25–75th pct" />
                <Legend color="#6366f1" opacity={0.16} label="10–90th pct" />
                <Legend color="#6366f1" opacity={0.08} label="Worst–Best" />
                <Legend color="#4f46e5" label="Median" line />
                <Legend color="#64748b" label="Contributed" line dashed />
              </div>
              <SummaryRow
                contributed={final.contributed}
                median={final.median}
                currency={currency}
              />
            </Card>
          </>
        ) : (
          <Card>
            <div className="flex h-80 flex-col items-center justify-center gap-2 text-center text-zinc-500">
              <p className="font-medium">Configure your plan and run a simulation</p>
              <p className="text-sm">
                Adjust the parameters on the left to project how your wealth could
                grow under thousands of market scenarios.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function PortfolioModelNote({ model }: { model: PortfolioModel }) {
  const guess = model.estimated;
  const theme = guess
    ? {
        box: "border-amber-300/70 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20",
        head: "text-amber-900 dark:text-amber-200",
        badge:
          "border-amber-400/60 bg-amber-100 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-200",
        bar: "bg-amber-400 dark:bg-amber-500",
      }
    : {
        box: "border-indigo-200 bg-indigo-50 dark:border-indigo-900/50 dark:bg-indigo-950/30",
        head: "text-indigo-900 dark:text-indigo-200",
        badge:
          "border-indigo-300/60 bg-indigo-100 text-indigo-800 dark:border-indigo-700/60 dark:bg-indigo-900/40 dark:text-indigo-200",
        bar: "bg-indigo-400 dark:bg-indigo-500",
      };

  return (
    <div className={`rounded-xl border p-3.5 text-xs ${theme.box}`}>
      <div className={`flex items-center justify-between gap-2 ${theme.head}`}>
        <span className="font-semibold">Per-asset model</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${theme.badge}`}>
          {guess ? "Estimate" : `${model.sampleYears.toFixed(1)} yrs history`}
        </span>
      </div>

      {guess && (
        <p className="mt-2 text-amber-800/90 dark:text-amber-200/80">
          Some holdings have too little price history to measure reliably, so
          their return and risk below are a rough <strong>guess</strong>. The
          projection will sharpen as more market data accrues.
        </p>
      )}

      <ul className="mt-3 space-y-2.5">
        {model.assets.map((a) => (
          <li key={a.name}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium text-zinc-700 dark:text-zinc-200">
                {a.name}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-700 dark:text-zinc-200">
                {formatPercent(a.mean)}{" "}
                <span className="text-zinc-400">/ σ {pct(a.vol)}</span>
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full ${theme.bar}`}
                  style={{ width: `${Math.min(100, a.weight * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                {pct(a.weight, 0)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {a.estimated
                ? `guess · only ${a.years.toFixed(1)} yr of data`
                : `${a.years.toFixed(1)} yr of history`}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-current/10 pt-2 text-zinc-500">
        Each holding is simulated with its own volatility; correlations come from
        the {model.corrYears.toFixed(1)} yr the holdings overlap.
      </p>
    </div>
  );
}

function EstimateNote({
  stats,
  usingEstimates,
  onReset,
}: {
  stats: PortfolioStats;
  usingEstimates: boolean;
  onReset: () => void;
}) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs dark:border-indigo-900/50 dark:bg-indigo-950/30">
      <div className="flex items-center justify-between">
        <span className="font-medium text-indigo-900 dark:text-indigo-200">
          Estimated from {stats.sampleYears.toFixed(1)} yrs of{" "}
          {stats.real ? "real market" : "modelled"} history
        </span>
        {!usingEstimates && (
          <button
            type="button"
            onClick={onReset}
            className="font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300"
          >
            Reset
          </button>
        )}
      </div>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        {stats.fromBenchmark
          ? "Based on a diversified world-equity benchmark (no holdings yet)."
          : "Based on the value-weighted historical returns of your holdings."}{" "}
        μ&nbsp;{formatPercent(stats.expectedReturn)} · σ&nbsp;{pct(stats.volatility)}.
      </p>
      {(!stats.real || stats.sampleYears < 3) && (
        <p className="mt-1 text-amber-700 dark:text-amber-300">
          Limited price history — treat these as a rough guess.
        </p>
      )}
      {!stats.fromBenchmark && stats.perAsset.length > 1 && (
        <ul className="mt-2 space-y-0.5 text-zinc-500">
          {stats.perAsset.map((a) => (
            <li key={a.name} className="flex justify-between gap-2 tabular-nums">
              <span className="truncate">
                {a.name} ({pct(a.weight, 0)})
              </span>
              <span>
                {formatPercent(a.annualReturn)} / σ {pct(a.annualVol)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryRow({
  contributed,
  median,
  currency,
}: {
  contributed: number;
  median: number;
  currency: string;
}) {
  const growth = median - contributed;
  return (
    <div className="mt-4 grid grid-cols-3 gap-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
      <div>
        <div className="text-zinc-500">Total contributed</div>
        <div className="font-medium tabular-nums">{formatCurrency(contributed, currency)}</div>
      </div>
      <div>
        <div className="text-zinc-500">Projected growth (median)</div>
        <div className={`font-medium tabular-nums ${plColor(growth)}`}>
          {formatCurrency(growth, currency)}
        </div>
      </div>
      <div>
        <div className="text-zinc-500">Multiple</div>
        <div className="font-medium tabular-nums">
          {contributed > 0 ? `${(median / contributed).toFixed(2)}×` : "—"}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  step = "1",
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: string;
  min?: number;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="group relative mt-1">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          // Hide the native spinner (it overlapped the suffix) and leave room
          // for the unit label on the right.
          className={`w-full rounded-lg border border-zinc-300 bg-transparent py-2 pl-3 text-sm tabular-nums outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:focus:border-zinc-300 dark:focus:ring-white/10 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
            suffix ? "pr-12" : "pr-3"
          }`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  opacity = 1,
  line = false,
  dashed = false,
}: {
  color: string;
  label: string;
  opacity?: number;
  line?: boolean;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{
          backgroundColor: line ? "transparent" : color,
          opacity: line ? 1 : opacity,
          borderTop: line
            ? `2px ${dashed ? "dashed" : "solid"} ${color}`
            : undefined,
        }}
      />
      {label}
    </span>
  );
}
