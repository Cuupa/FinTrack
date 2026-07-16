"use client";

// Monte Carlo simulation UI (PRD §3.3). Collects the simulation parameters,
// runs 1,000+ paths in a Web Worker, and renders the probability fan plus
// best/median/worst outcomes. Initial capital defaults to current net worth.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { estimatePortfolioModel, type PortfolioModel } from "@/lib/finance/stats";
import { monthlyContributionOf } from "@/lib/finance/savings-plans";
import {
  runMonteCarlo,
  runPortfolioMonteCarlo,
  type MonteCarloParams,
  type MonteCarloResult,
  type PortfolioMonteCarloParams,
} from "@/lib/finance/monte-carlo";
import { formatCurrency, formatPercent, plColor } from "@/lib/format";
import { Button, Card, Stat, SegmentedControl } from "@/components/ui/primitives";
import { Slider } from "@/components/ui/slider";
import { InfoTip } from "@/components/ui/info-tip";
import { useI18n } from "@/lib/i18n/i18n-context";
import { DistributionChart } from "@/components/charts/distribution-chart";
import type { ChartScale } from "@/components/charts/performance-chart";
import { useFeatureFlags } from "@/lib/flags/flags-context";

type SimMode = "portfolio" | "custom";

// Custom-mode defaults (percent). Deliberately independent of the user's
// holdings — a neutral world-equity baseline the user can override.
const CUSTOM_RETURN_DEFAULT = 7;
const CUSTOM_VOL_DEFAULT = 16;
// Default annual withdrawal rate (percent) — the classic "4% rule".
const WITHDRAWAL_RATE_DEFAULT = 4;

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Stable cache key from the params, ignoring the seed (same inputs → reuse). */
function hashSimParams(
  kind: "scalar" | "portfolio",
  params: MonteCarloParams | PortfolioMonteCarloParams,
): string {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  let canon: unknown;
  if (kind === "portfolio") {
    const p = params as PortfolioMonteCarloParams;
    canon = {
      kind,
      initialCapital: r(p.initialCapital),
      monthlyContribution: r(p.monthlyContribution),
      years: p.years,
      runs: p.runs,
      withdrawalYears: p.withdrawalYears ?? 0,
      withdrawalRate: r(p.withdrawalRate ?? 0),
      rebalanceYearly: !!p.rebalanceYearly,
      assets: p.assets.map((a) => ({ weight: r(a.weight), mean: r(a.mean), vol: r(a.vol) })),
      corr: p.corr.map((row) => row.map(r)),
    };
  } else {
    const p = params as MonteCarloParams;
    canon = {
      kind,
      initialCapital: r(p.initialCapital),
      monthlyContribution: r(p.monthlyContribution),
      years: p.years,
      runs: p.runs,
      withdrawalYears: p.withdrawalYears ?? 0,
      withdrawalRate: r(p.withdrawalRate ?? 0),
      expectedReturn: r(p.expectedReturn),
      volatility: r(p.volatility),
    };
  }
  return fnv1a(JSON.stringify(canon));
}

/** A fresh 32-bit seed from Web Crypto (never Math.random) for the sim PRNG. */
function randomSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Unsigned percentage (for volatility and weights). */
function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function MonteCarloPanel() {
  const { data, loadSimulation, saveSimulation } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
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

  // Savings-plan-derived monthly contribution (base currency), summed across
  // active plans and converted from each plan's asset currency.
  const hasSavingsPlans = data.savingsPlans.some((p) => p.active);
  const monthlyFromPlans = useMemo(
    () => monthlyContributionOf(data.savingsPlans, data.assets, valuation),
    [data.savingsPlans, data.assets, valuation],
  );

  // Default to simulating the real portfolio when there is one.
  const [mode, setMode] = useState<SimMode>("portfolio");

  const [form, setForm] = useState({
    monthlyContribution: 500,
    years: 30,
    runs: 5000,
    withdrawalYears: 0,
    withdrawalRate: WITHDRAWAL_RATE_DEFAULT,
  });
  const [rebalanceYearly, setRebalanceYearly] = useState(false);

  // Estimate returns/volatility from the last `horizon` years of history, so the
  // figures are the average over the selected period and change with it (capped
  // by how much real history exists).
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

  // Per-asset model (each asset's μ/σ + correlation) for the portfolio mode.
  const model = useMemo(
    () => estimatePortfolioModel(holdings, lookbackYears, histories),
    [holdings, lookbackYears, histories],
  );
  // Sub-feature flags: the "My portfolio" and "Custom" sections, and the
  // withdrawal phase, can each be turned off independently.
  const { isEnabled } = useFeatureFlags();
  const portfolioAllowed = isEnabled("simulationPortfolio");
  const customAllowed = isEnabled("simulationCustom");
  const withdrawalAllowed = isEnabled("simulationWithdrawal");

  const hasPortfolio = model !== null && model.assets.length > 0 && portfolioAllowed;
  // Pick a mode honouring the flags: custom off ⇒ force portfolio; portfolio
  // unavailable ⇒ force custom; otherwise use the user's choice.
  const effectiveMode: SimMode = !customAllowed
    ? "portfolio"
    : !hasPortfolio
      ? "custom"
      : mode;
  const showModeToggle = hasPortfolio && customAllowed;
  // Estimated parameters are the defaults; overrides (if the user edits a
  // field) take precedence. Derived rather than synced via an effect.
  const [capitalOverride, setCapitalOverride] = useState<number | null>(null);
  const [returnOverride, setReturnOverride] = useState<number | null>(null);
  const [volOverride, setVolOverride] = useState<number | null>(null);
  // Default to using the savings-plan-derived contribution when plans exist;
  // an explicit toggle overrides the default, same pattern as the overrides
  // above.
  const [useSavingsPlansOverride, setUseSavingsPlansOverride] = useState<boolean | null>(
    null,
  );
  const useSavingsPlans = useSavingsPlansOverride ?? hasSavingsPlans;
  const effectiveMonthlyContribution = useSavingsPlans
    ? monthlyFromPlans
    : form.monthlyContribution;
  // Per-asset μ/σ overrides (portfolio mode), keyed by asset name. Percent units.
  const [assetOverrides, setAssetOverrides] = useState<
    Record<string, { mean?: number; vol?: number }>
  >({});

  const initialCapital =
    capitalOverride ?? (netWorth > 0 ? Math.round(netWorth) : 10000);
  // Custom mode deliberately IGNORES the user's holdings: it starts from the
  // research-backed defaults (7% p.a. return, 16% volatility) which the user can
  // then change. Only the "My portfolio" mode measures μ/σ from real history.
  const expectedReturn = returnOverride ?? CUSTOM_RETURN_DEFAULT;
  const volatility = volOverride ?? CUSTOM_VOL_DEFAULT;
  const usingEstimates = returnOverride === null && volOverride === null;

  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [scale, setScale] = useState<ChartScale>("log");
  const [hover, setHover] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // In "My portfolio" mode the parameters are auto-derived; the user must opt in
  // to editing them.
  const [editing, setEditing] = useState(false);
  const locked = effectiveMode === "portfolio" && !editing;
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
    // Clamp to [1,000, 25,000] paths.
    const runs = Math.min(25000, Math.max(1000, Math.round(form.runs)));
    const withdrawalYears = withdrawalAllowed ? Math.max(0, Math.round(form.withdrawalYears)) : 0;
    const withdrawalRate = Math.max(0, form.withdrawalRate) / 100;
    // Seed the run's PRNG from Web Crypto (never Math.random), so the run is
    // reproducible and the seed can be persisted for auditing.
    const seed = randomSeed();

    // Portfolio mode simulates each holding with its own μ/σ and the
    // correlation structure; custom mode uses a single μ/σ.
    const message =
      effectiveMode === "portfolio" && model
        ? {
            kind: "portfolio" as const,
            params: {
              initialCapital,
              monthlyContribution: effectiveMonthlyContribution,
              years,
              runs,
              assets: model.assets.map((a) => {
                const o = assetOverrides[a.name];
                return {
                  weight: a.weight,
                  mean: o?.mean != null ? o.mean / 100 : a.mean,
                  vol: o?.vol != null ? o.vol / 100 : a.vol,
                };
              }),
              corr: model.corr,
              seed,
              withdrawalYears,
              withdrawalRate,
              rebalanceYearly,
            } satisfies PortfolioMonteCarloParams,
          }
        : {
            kind: "scalar" as const,
            params: {
              initialCapital,
              monthlyContribution: effectiveMonthlyContribution,
              years,
              expectedReturn: expectedReturn / 100,
              volatility: volatility / 100,
              runs,
              seed,
              withdrawalYears,
              withdrawalRate,
            } satisfies MonteCarloParams,
          };

    const hash = hashSimParams(message.kind, message.params);
    setRunning(true);

    // Prefer a Web Worker for the "background" execution the PRD asks for, but
    // never let a worker hiccup break the feature: any failure to construct,
    // load, or respond falls back to the same pure computation on the main
    // thread. The sim is fast enough that the fallback is imperceptible.
    let settled = false;
    const finish = (r: MonteCarloResult, fromCache = false) => {
      if (settled) return;
      settled = true;
      setResult(r);
      setRunning(false);
      workerRef.current?.terminate();
      workerRef.current = null;
      // Persist fresh runs so an identical re-run reuses the stored result.
      if (!fromCache) {
        void saveSimulation({
          hash,
          params: message.params,
          seed,
          result: r,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
      }
    };
    const fallback = () =>
      finish(
        message.kind === "portfolio"
          ? runPortfolioMonteCarlo(message.params)
          : runMonteCarlo(message.params),
      );

    const compute = () => {
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
    };

    // Reuse a stored run with identical params before computing anything.
    void loadSimulation(hash)
      .then((cached) => {
        if (settled) return;
        if (cached && cached.result) {
          finish(cached.result as MonteCarloResult, true);
        } else {
          compute();
        }
      })
      .catch(() => {
        if (!settled) compute();
      });
  }

  const final = result?.bands[result.bands.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <h2 className="text-lg font-semibold">{t("sim.parameters")}</h2>
        <div className="mt-4 space-y-4">
          {/* Accumulation phase: initial capital, contribution, horizon. */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t("sim.accumulationPhase")}
            </h3>
            <div className="mt-3 space-y-4">
              <SliderField
                label={t("sim.initialCapital")}
                suffix={currency}
                value={initialCapital}
                onChange={(v) => setCapitalOverride(v)}
                min={0}
                max={Math.max(100000, Math.round((netWorth || 0) * 3))}
                step={1000}
                lockable={effectiveMode === "portfolio"}
                locked={locked}
                onToggleLock={() => {
                  if (locked) setEditing(true);
                  else {
                    setEditing(false);
                    setCapitalOverride(null); // re-lock → back to net worth
                  }
                }}
              />
              <div>
                {hasSavingsPlans && (
                  <label className="mb-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={useSavingsPlans}
                      onChange={(e) => setUseSavingsPlansOverride(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <span>
                      {t("sim.useSavingsPlans", {
                        amount: formatCurrency(monthlyFromPlans, currency),
                      })}
                    </span>
                  </label>
                )}
                {useSavingsPlans ? (
                  <div>
                    <label className="text-sm font-medium">
                      {t("sim.monthlyContribution")}
                    </label>
                    <div className="mt-1 text-sm font-semibold tabular-nums opacity-70">
                      {formatCurrency(monthlyFromPlans, currency)}
                    </div>
                  </div>
                ) : (
                  <SliderField
                    label={t("sim.monthlyContribution")}
                    suffix={currency}
                    value={form.monthlyContribution}
                    onChange={(v) => update("monthlyContribution", v)}
                    min={0}
                    max={5000}
                    step={50}
                  />
                )}
              </div>
              <SliderField
                label={t("sim.horizon")}
                suffix={t("sim.years")}
                value={form.years}
                onChange={(v) => update("years", v)}
                min={1}
                max={40}
                step={1}
              />
            </div>
          </div>

          {/* Withdrawal phase (feature-flagged decumulation). */}
          {withdrawalAllowed && (
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t("sim.withdrawalYears")}
              </h3>
              <div className="mt-3 space-y-3">
                <SliderField
                  label={t("sim.withdrawalDuration")}
                  suffix={t("sim.years")}
                  value={form.withdrawalYears}
                  onChange={(v) => update("withdrawalYears", v)}
                  min={0}
                  max={40}
                  step={1}
                />
                {form.withdrawalYears > 0 && (
                  <div className="space-y-2">
                    <SliderField
                      label={t("sim.withdrawalRate")}
                      suffix="%"
                      value={form.withdrawalRate}
                      onChange={(v) => update("withdrawalRate", v)}
                      min={0}
                      max={10}
                      step={0.1}
                      digits={1}
                    />
                    <p className="text-xs text-zinc-500">{t("sim.withdrawalRateHint")}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Model: My portfolio / Custom, the model note, rebalancing (a
              property of the portfolio model), and the run count. */}
          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t("sim.model")}
              </h3>
              <InfoTip text={t("sim.guidelinesTip")} />
            </div>
            <div className="mt-3 space-y-4">
              {showModeToggle && (
                <div>
                  <SegmentedControl<SimMode>
                    value={effectiveMode}
                    onChange={setMode}
                    options={[
                      { label: t("sim.myPortfolio"), value: "portfolio" },
                      { label: t("sim.custom"), value: "custom" },
                    ]}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    {effectiveMode === "portfolio"
                      ? t("sim.modelPortfolioDesc")
                      : t("sim.modelCustomDesc")}
                  </p>
                </div>
              )}

              {effectiveMode === "portfolio" && model ? (
                <PortfolioModelNote
                  model={model}
                  overrides={assetOverrides}
                  onOverride={(name, patch) =>
                    setAssetOverrides((o) => ({ ...o, [name]: { ...o[name], ...patch } }))
                  }
                  onResetOverrides={() => setAssetOverrides({})}
                />
              ) : (
                <>
                  <CustomAssumptionsNote
                    usingEstimates={usingEstimates}
                    onReset={resetToEstimates}
                  />
                  <SliderField
                    label={t("sim.expectedReturn")}
                    suffix="%"
                    value={expectedReturn}
                    onChange={(v) => setReturnOverride(v)}
                    min={-5}
                    max={20}
                    step={0.1}
                    digits={1}
                  />
                  <SliderField
                    label={t("sim.volatility")}
                    suffix="%"
                    value={volatility}
                    onChange={(v) => setVolOverride(v)}
                    min={0}
                    max={60}
                    step={0.5}
                    digits={1}
                  />
                </>
              )}

              {effectiveMode === "portfolio" && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rebalanceYearly}
                    onChange={(e) => setRebalanceYearly(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span>{t("sim.rebalanceYearly")}</span>
                </label>
              )}

              <SliderField
                label={t("sim.runs")}
                value={form.runs}
                onChange={(v) => update("runs", v)}
                min={1000}
                max={25000}
                step={500}
              />
            </div>
          </div>

          <Button variant="primary" className="w-full" onClick={run} disabled={running}>
            {running ? t("sim.running") : t("sim.run")}
          </Button>
        </div>
      </Card>

      <div className="space-y-6 lg:col-span-2">
        {result && final ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <Stat
                  label={t("sim.median")}
                  value={formatCurrency(final.median, currency)}
                  sub={`${result.params.years} ${t("sim.years")}`}
                  info={t("sim.tipMedian")}
                />
              </Card>
              <Card>
                <Stat
                  label={t("sim.optimistic")}
                  value={formatCurrency(final.p90, currency)}
                  valueClassName={plColor(1)}
                  info={t("sim.tipOptimistic")}
                />
              </Card>
              <Card>
                <Stat
                  label={t("sim.pessimistic")}
                  value={formatCurrency(final.p10, currency)}
                  valueClassName={plColor(-1)}
                  info={t("sim.tipPessimistic")}
                />
              </Card>
            </div>

            {/* Decumulation: how much this plan lets you draw each year/month. */}
            {result.withdrawal && (
              <Card>
                <h2 className="flex items-center gap-1.5 text-lg font-semibold">
                  {t("sim.withdrawalTitle")}
                  <InfoTip text={t("sim.withdrawalMetricsTip")} />
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <WithdrawalStat
                    label={t("sim.pessimistic")}
                    annual={result.withdrawal.p10}
                    currency={currency}
                    valueClassName={plColor(-1)}
                  />
                  <WithdrawalStat
                    label={t("sim.median")}
                    annual={result.withdrawal.median}
                    currency={currency}
                  />
                  <WithdrawalStat
                    label={t("sim.optimistic")}
                    annual={result.withdrawal.p90}
                    currency={currency}
                    valueClassName={plColor(1)}
                  />
                </div>
              </Card>
            )}

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{t("sim.projectedWealth")}</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <SegmentedControl<ChartScale>
                    size="sm"
                    value={scale}
                    onChange={setScale}
                    options={[
                      { label: t("sim.linear"), value: "linear" },
                      { label: t("sim.logarithmic"), value: "log" },
                    ]}
                  />
                  <span className="text-xs text-zinc-500">
                    {result.params.runs.toLocaleString()} {t("sim.runsLabel")}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <DistributionChart
                  result={result}
                  currency={currency}
                  scale={scale}
                  highlight={hover}
                  phaseBoundaryYear={
                    result.params.withdrawalYears ? result.params.years : undefined
                  }
                  phaseBoundaryLabel={
                    result.params.withdrawalYears ? t("sim.withdrawalStarts") : undefined
                  }
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <Legend color="#6366f1" opacity={0.5} label={t("sim.band50")} info={t("sim.tipBand50")} seriesKey="range50" onHover={setHover} />
                <Legend color="#6366f1" opacity={0.32} label={t("sim.band80")} info={t("sim.tipBand80")} seriesKey="range80" onHover={setHover} />
                <Legend color="#6366f1" opacity={0.16} label={t("sim.bandFull")} info={t("sim.tipBandFull")} seriesKey="rangeFull" onHover={setHover} />
                <Legend color="#4f46e5" label={t("sim.medianLine")} line info={t("sim.tipMedian")} seriesKey="median" onHover={setHover} />
                <Legend color="#64748b" label={t("sim.contributedLine")} line dashed info={t("sim.tipContributed")} seriesKey="contributed" onHover={setHover} />
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
              <p className="font-medium">{t("sim.configurePrompt")}</p>
              <p className="text-sm">{t("sim.configureHint")}</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function PortfolioModelNote({
  model,
  overrides,
  onOverride,
  onResetOverrides,
  editable = true,
}: {
  model: PortfolioModel;
  overrides: Record<string, { mean?: number; vol?: number }>;
  onOverride: (name: string, patch: { mean?: number; vol?: number }) => void;
  onResetOverrides: () => void;
  editable?: boolean;
}) {
  const { t } = useI18n();
  // Pure guess = at least one holding has NO real history; otherwise figures are
  // data-backed (possibly blended toward the long-run prior for short windows).
  const pureGuess = model.assets.some((a) => !a.real);
  const blended = model.assets.some((a) => a.real && a.estimated);
  const theme = pureGuess
    ? {
        box: "border-amber-300/70 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20",
        head: "text-amber-900 dark:text-amber-200",
        bar: "bg-amber-400 dark:bg-amber-500",
      }
    : {
        box: "border-indigo-200 bg-indigo-50 dark:border-indigo-900/50 dark:bg-indigo-950/30",
        head: "text-indigo-900 dark:text-indigo-200",
        bar: "bg-indigo-400 dark:bg-indigo-500",
      };

  const [adv, setAdv] = useState(false);
  const hasOverrides = Object.values(overrides).some((o) => o.mean != null || o.vol != null);

  return (
    <div className={`rounded-xl border p-3.5 text-xs ${theme.box}`}>
      <div className={`flex items-center justify-between gap-2 ${theme.head}`}>
        <span className="font-semibold">{t("sim.perAssetModel")}</span>
        <span className="text-right text-[11px] font-medium">
          {pureGuess
            ? t("sim.estimate")
            : blended
              ? t("sim.blended")
              : t("sim.yrsHistory", { years: model.sampleYears.toFixed(1) })}
        </span>
      </div>

      {pureGuess ? (
        <p className="mt-2 text-amber-800/90 dark:text-amber-200/80">{t("sim.pureGuessNote")}</p>
      ) : blended ? (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">{t("sim.blendedNote")}</p>
      ) : null}

      {editable && (
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setAdv((v) => !v)}
            className="text-[11px] font-medium text-indigo-700 hover:underline dark:text-indigo-300"
          >
            {adv ? t("sim.hideOverrides") : t("sim.overridePerAsset")}
          </button>
          {hasOverrides && (
            <button
              type="button"
              onClick={onResetOverrides}
              className="text-[11px] font-medium text-zinc-500 hover:underline"
            >
              {t("sim.resetOverrides")}
            </button>
          )}
        </div>
      )}

      <ul className="mt-3 space-y-2.5">
        {model.assets.map((a) => {
          const o = overrides[a.name];
          const effMean = o?.mean != null ? o.mean / 100 : a.mean;
          const effVol = o?.vol != null ? o.vol / 100 : a.vol;
          const overridden = o?.mean != null || o?.vol != null;
          return (
            <li key={a.name}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-zinc-700 dark:text-zinc-200">
                  {a.name}
                </span>
                <span className="shrink-0 tabular-nums text-zinc-700 dark:text-zinc-200">
                  {formatPercent(effMean)}{" "}
                  <span className="text-zinc-400">/ σ {pct(effVol)}</span>
                  {overridden && <span className="ml-1 text-indigo-500">•</span>}
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
              {adv ? (
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <OverrideInput
                    label={t("sim.returnPercent")}
                    value={o?.mean ?? round1(a.mean * 100)}
                    onChange={(v) => onOverride(a.name, { mean: v })}
                  />
                  <OverrideInput
                    label={t("sim.volPercent")}
                    value={o?.vol ?? round1(a.vol * 100)}
                    onChange={(v) => onOverride(a.name, { vol: v })}
                  />
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  {!a.real
                    ? t("sim.longRunAssumption")
                    : a.estimated
                      ? t("sim.yrHistoryBlended", { years: a.years.toFixed(1) })
                      : t("sim.yrHistory", { years: a.years.toFixed(1) })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-current/10 pt-2 text-zinc-500">
        {t("sim.corrNote", { years: model.corrYears.toFixed(1) })}
      </p>
    </div>
  );
}

/** Compact labelled numeric input for a per-asset μ/σ override. */
function OverrideInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span className="shrink-0">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full min-w-0 rounded-md border border-zinc-300 bg-white/60 px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  );
}

function CustomAssumptionsNote({
  usingEstimates,
  onReset,
}: {
  usingEstimates: boolean;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs dark:border-indigo-900/50 dark:bg-indigo-950/30">
      <div className="flex items-center justify-between">
        <span className="font-medium text-indigo-900 dark:text-indigo-200">
          {t("sim.customAssumptions")}
        </span>
        {!usingEstimates && (
          <button
            type="button"
            onClick={onReset}
            className="font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300"
          >
            {t("sim.resetToDefaults", {
              ret: CUSTOM_RETURN_DEFAULT,
              vol: CUSTOM_VOL_DEFAULT,
            })}
          </button>
        )}
      </div>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        {t("sim.customAssumptionsNote", {
          ret: CUSTOM_RETURN_DEFAULT,
          vol: CUSTOM_VOL_DEFAULT,
        })}
      </p>
    </div>
  );
}

/** One percentile of the annual withdrawal amount, with its monthly equivalent. */
function WithdrawalStat({
  label,
  annual,
  currency,
  valueClassName = "",
}: {
  label: string;
  annual: number;
  currency: string;
  valueClassName?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName}`}>
        {formatCurrency(annual, currency)}
        <span className="ml-1 text-sm font-normal text-zinc-400">/{t("sim.perYear")}</span>
      </div>
      <div className="mt-0.5 text-sm tabular-nums text-zinc-500">
        {formatCurrency(annual / 12, currency)}/{t("sim.perMonth")}
      </div>
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
  const { t } = useI18n();
  const growth = median - contributed;
  return (
    <div className="mt-4 grid grid-cols-3 gap-4 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
      <div>
        <div className="text-zinc-500">{t("sim.contributed")}</div>
        <div className="font-medium tabular-nums">{formatCurrency(contributed, currency)}</div>
      </div>
      <div>
        <div className="text-zinc-500">{t("sim.growth")}</div>
        <div className={`font-medium tabular-nums ${plColor(growth)}`}>
          {formatCurrency(growth, currency)}
        </div>
      </div>
      <div>
        <div className="text-zinc-500">{t("sim.multiple")}</div>
        <div className="font-medium tabular-nums">
          {contributed > 0 ? `${(median / contributed).toFixed(2)}×` : "—"}
        </div>
      </div>
    </div>
  );
}

/**
 * Dual-mode parameter control: a slider by default, with an "Enter value"
 * toggle that swaps in a precise numeric field (and back). Used for every
 * scalar simulation input.
 */
function SliderField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max = 100,
  step = 1,
  digits = 0,
  lockable = false,
  locked = false,
  onToggleLock,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  /** Show a lock toggle (e.g. Initial capital, auto-set from net worth). */
  lockable?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
}) {
  const { t } = useI18n();
  const [manual, setManual] = useState(false);
  const display = digits > 0 ? value.toFixed(digits) : Math.round(value).toLocaleString();

  const lockBtn = lockable ? (
    <button
      type="button"
      onClick={onToggleLock}
      title={locked ? t("sim.capitalLocked") : t("sim.capitalUnlocked")}
      aria-label={locked ? t("sim.capitalLocked") : t("sim.capitalUnlocked")}
      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        {locked ? <path d="M8 11V7a4 4 0 0 1 8 0v4" /> : <path d="M8 11V7a4 4 0 0 1 7.5-2" />}
      </svg>
    </button>
  ) : null;

  if (lockable && locked) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label className="text-sm font-medium">{label}</label>
          {lockBtn}
        </div>
        <div className="mt-1 text-sm font-semibold tabular-nums opacity-70">
          {display}
          {suffix ? <span className="ml-1 text-xs font-normal text-zinc-400">{suffix}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setManual((m) => !m)}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {manual ? t("sim.useSlider") : t("sim.enterValue")}
          </button>
          {lockBtn}
        </div>
      </div>
      {manual ? (
        <div className="group relative mt-1">
          <input
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
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
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1">
            <Slider min={min} max={max} step={step} value={value} onChange={onChange} aria-label={label} />
          </div>
          <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
            {display}
            {suffix ? <span className="ml-1 text-xs text-zinc-400">{suffix}</span> : null}
          </span>
        </div>
      )}
    </div>
  );
}

function Legend({
  color,
  label,
  opacity = 1,
  line = false,
  dashed = false,
  info,
  seriesKey,
  onHover,
}: {
  color: string;
  label: string;
  opacity?: number;
  line?: boolean;
  dashed?: boolean;
  info?: string;
  seriesKey?: string;
  onHover?: (k: string | null) => void;
}) {
  return (
    <span
      className="inline-flex cursor-default items-center gap-1.5 rounded-md px-1 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      onMouseEnter={() => seriesKey && onHover?.(seriesKey)}
      onMouseLeave={() => onHover?.(null)}
    >
      {line ? (
        <span
          className="inline-block h-0 w-4 align-middle"
          style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }}
        />
      ) : (
        <span
          className="inline-block h-3.5 w-3.5 rounded-[3px] border border-zinc-300/50 dark:border-zinc-600/50"
          style={{ backgroundColor: color, opacity }}
        />
      )}
      {label}
      {info && <InfoTip text={info} />}
    </span>
  );
}
