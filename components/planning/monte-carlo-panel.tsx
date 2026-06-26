"use client";

// Monte Carlo planning UI (PRD §3.3). Collects the simulation parameters,
// runs 1,000+ paths in a Web Worker, and renders the probability fan plus
// best/median/worst outcomes. Initial capital defaults to current net worth.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { summarizeAll } from "@/lib/finance/portfolio";
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

type SimMode = "portfolio" | "custom";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Unsigned percentage (for volatility and weights). */
function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

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

  // Aggregate portfolio statistics (single μ/σ) for the custom mode default.
  const stats = useMemo(() => portfolioOrBenchmarkStats(holdings), [holdings]);
  // Per-asset model (each asset's μ/σ + correlation) for the portfolio mode.
  const model = useMemo(() => estimatePortfolioModel(holdings), [holdings]);
  const hasPortfolio = model !== null && model.assets.length > 0;

  // Default to simulating the real portfolio when there is one.
  const [mode, setMode] = useState<SimMode>("portfolio");
  const effectiveMode: SimMode = hasPortfolio ? mode : "custom";

  const [form, setForm] = useState({
    monthlyContribution: 500,
    years: 30,
    runs: 1000,
  });
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
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Projected wealth</h2>
                <span className="text-xs text-zinc-500">
                  {result.params.runs.toLocaleString()} runs
                </span>
              </div>
              <div className="mt-4">
                <DistributionChart result={result} currency={currency} />
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
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs dark:border-indigo-900/50 dark:bg-indigo-950/30">
      <div className="font-medium text-indigo-900 dark:text-indigo-200">
        Per-asset model · {model.sampleYears.toFixed(1)} yrs of history
      </div>
      <ul className="mt-2 space-y-0.5 text-zinc-600 dark:text-zinc-400">
        {model.assets.map((a) => (
          <li key={a.name} className="flex justify-between gap-2 tabular-nums">
            <span className="truncate">
              {a.name} ({pct(a.weight, 0)})
            </span>
            <span>
              {formatPercent(a.mean)} / σ {pct(a.vol)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-zinc-500">
        Each holding is simulated with its own volatility and their historical
        correlations.
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
          Estimated from {stats.sampleYears.toFixed(1)} yrs of history
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
      <div className="relative">
        <input
          type="number"
          step={step}
          min={min}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={inputCls}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
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
