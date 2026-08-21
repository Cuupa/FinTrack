"use client";

// Monte Carlo simulation UI (PRD §3.3). Collects the simulation parameters,
// runs 1,000+ paths in a Web Worker, and renders the probability fan plus
// best/median/worst outcomes. Initial capital defaults to current net worth.

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { estimatePortfolioModel, type PortfolioModel } from "@/lib/finance/stats";
import { monthlyContributionOf } from "@/lib/finance/savings-plans";
import type {
  MonteCarloParams,
  PortfolioMonteCarloParams,
} from "@/lib/finance/monte-carlo";
import { formatCurrency, formatInputDecimal, formatPercent, parseDecimal, plColor, stripLeadingZero } from "@/lib/format";
import { Button, Card, EmptyState, SectionTitle, Stat, StatRow, SegmentedControl, Toggle } from "@/components/ui/primitives";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Slider } from "@/components/ui/slider";
import { Tabs } from "@/components/ui/tabs";
import { randomSeed, useMonteCarloRun } from "@/lib/simulation/use-monte-carlo";
import { usePensionBridge } from "@/lib/pension/use-pension-bridge";
import {
  DEFAULT_INFLATION,
  type StressScenario,
  type WithdrawalStrategyId,
} from "@/lib/finance/withdrawal";
import {
  StressPicker,
  WithdrawalComparison,
  WithdrawalStrategyPanel,
} from "@/components/simulation/withdrawal-strategy-panel";
import { InfoTip } from "@/components/ui/info-tip";
import { useI18n } from "@/lib/i18n/i18n-context";
import { DistributionChart } from "@/components/charts/distribution-chart";
import type { ChartScale } from "@/components/charts/performance-chart";
import { useFeatureFlags, type FeatureState } from "@/lib/flags/flags-context";
import { ProGate } from "@/components/billing/pro-teaser";
import { SimulationTour, TourReplayButton } from "@/components/onboarding/page-tours";

type SimMode = "portfolio" | "custom";

// Custom-mode defaults (percent). Deliberately independent of the user's
// holdings — a neutral world-equity baseline the user can override.
const CUSTOM_RETURN_DEFAULT = 7;
const CUSTOM_VOL_DEFAULT = 16;
// Default annual withdrawal rate (percent) — the classic "4% rule".
const WITHDRAWAL_RATE_DEFAULT = 4;
const DEFAULT_ACCUMULATION_YEARS = 30;

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
  //
  // There is no separate "retirement" model: years-to-FI IS the investment
  // horizon, and a drawdown is a phase of the same run. The FIRE tab therefore
  // links in with `?years=<years to FI>&withdrawal=30`, which seeds this run's
  // horizon and switches its withdrawal phase on -- one simulation, arrived at
  // from either side. Read through useSearchParams (the page carries the
  // Suspense boundary): on a client-side navigation the panel can mount before
  // the history entry lands, so window.location would still be the old page.
  const params = useSearchParams();
  const seededYears = Number(params.get("years"));
  const seededWithdrawal = Number(params.get("withdrawal"));
  const [mode, setMode] = useState<SimMode>("portfolio");

  // Every scalar is an OVERRIDE: null means "whatever the mode or the link
  // says", so a horizon seeded from the FIRE plan needs no effect writing state
  // and an edited field always wins.
  const [form, setForm] = useState<{
    monthlyContribution: number | null;
    years: number | null;
    runs: number;
    withdrawalYears: number | null;
    withdrawalRate: number | null;
    inflation: number | null;
  }>({
    monthlyContribution: null,
    years: null,
    runs: 5000,
    withdrawalYears: null,
    withdrawalRate: null,
    inflation: null,
  });
  const [rebalanceYearly, setRebalanceYearly] = useState(false);

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

  // The FIRE plan's own inputs — net worth including accounts, trailing
  // expenses, the measured return, the pension bridge — so a run seeded from
  // the FIRE tab simulates the very plan that tab prints.
  // Sub-feature flags: the "My portfolio" and "Custom" sections, and the
  // withdrawal phase, can each be turned off independently — and each be
  // tiered to Pro on its own. A flag that is OFF hides its section; a flag
  // that is Pro-LOCKED keeps the section visible and blurs it behind the
  // <ProTeaser> (owner rule: a paywalled feature stays visible, never
  // hidden), so `enabled` drives visibility and `!locked` drives function.
  const { getFeature } = useFeatureFlags();
  const portfolioFeature = getFeature("simulationPortfolio");
  const customFeature = getFeature("simulationCustom");
  const withdrawalFeature = getFeature("simulationWithdrawal");
  const withdrawalAllowed = withdrawalFeature.enabled && !withdrawalFeature.locked;

  // Tab strip source: only the modes that are visible, in a fixed order. A
  // Pro-locked mode still counts as visible and stays selectable — picking it
  // is how the user sees what Pro would unlock.
  const MODE_TABS: {
    value: SimMode;
    labelKey: "sim.myPortfolio" | "sim.custom";
    feature: FeatureState;
  }[] = [
    ...(holdings.length > 0 && portfolioFeature.enabled
      ? [{ value: "portfolio" as const, labelKey: "sim.myPortfolio" as const, feature: portfolioFeature }]
      : []),
    ...(customFeature.enabled
      ? [{ value: "custom" as const, labelKey: "sim.custom" as const, feature: customFeature }]
      : []),
  ];
  const activeTab = MODE_TABS.find((tab) => tab.value === mode) ?? MODE_TABS[0];
  const effectiveMode: SimMode = activeTab?.value ?? "custom";
  const showModeToggle = MODE_TABS.length > 1;
  // Paywall state of the selected mode: blurs the model parameters and blocks
  // the run, since a locked mode must never actually compute.
  const modeLocked = activeTab?.feature.locked ?? false;
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
  // Per-asset μ/σ overrides (portfolio mode), keyed by asset name. Percent units.
  const [assetOverrides, setAssetOverrides] = useState<
    Record<string, { mean?: number; vol?: number }>
  >({});

  // Custom mode deliberately IGNORES the user's holdings: it starts from the
  // research-backed defaults (7% p.a. return, 16% volatility) which the user can
  // then change. "My portfolio" measures μ/σ per asset from real history, and
  // Ruhestand uses the one measured figure the FIRE tab plans with.
  const expectedReturn = returnOverride ?? CUSTOM_RETURN_DEFAULT;
  const volatility = volOverride ?? CUSTOM_VOL_DEFAULT;
  const usingEstimates = returnOverride === null && volOverride === null;

  const withdrawalRate = form.withdrawalRate ?? WITHDRAWAL_RATE_DEFAULT;
  const inflation = form.inflation ?? DEFAULT_INFLATION * 100;

  // Ruhestand seeds itself from the FIRE plan at the rate selected here: the
  // horizon is the time to financial independence, the capital is today's net
  // worth including accounts, and the contribution is what the savings plans
  // actually pay in.
  // A horizon handed over by the FIRE tab: years to financial independence IS
  // the investment horizon, so it seeds this field instead of a mode of its own.
  const linkedYears =
    Number.isFinite(seededYears) && seededYears > 0
      ? Math.max(1, Math.min(80, Math.round(seededYears)))
      : null;
  const linkedWithdrawal =
    Number.isFinite(seededWithdrawal) && seededWithdrawal > 0
      ? Math.max(1, Math.min(60, Math.round(seededWithdrawal)))
      : null;
  // The pension is an input to the drawdown, not a neighbouring feature: a
  // retiree draws only what the guaranteed income fails to cover. The FIGURES
  // always come from the same projection the Pension tab renders, so a run can
  // never simulate a pension the user cannot find on screen; a FIRE link only
  // carries whether that plan counted it.
  const pension = usePensionBridge();
  const [countPensionOverride, setCountPensionOverride] = useState<boolean | null>(null);
  const countPension =
    countPensionOverride ?? (linkedYears == null || params.has("pensionAnnual"));
  const appliedPension =
    countPension && pension.bridge
      ? {
          annualPensionIncome: pension.bridge.annualIncome,
          pensionYearsUntilStart: pension.bridge.yearsUntilStart,
        }
      : null;

  const years = form.years ?? linkedYears ?? DEFAULT_ACCUMULATION_YEARS;
  const withdrawalYears = form.withdrawalYears ?? linkedWithdrawal ?? 0;
  const monthlyContribution = form.monthlyContribution ?? 500;
  const effectiveMonthlyContribution = useSavingsPlans ? monthlyFromPlans : monthlyContribution;

  const initialCapital =
    capitalOverride ?? (netWorth > 0 ? Math.round(netWorth) : 10000);

  // Estimate returns/volatility from the last `horizon` years of history, so the
  // figures are the average over the selected period and change with it (capped
  // by how much real history exists).
  const lookbackYears = Math.max(1, Math.round(years));
  // Per-asset model (each asset's μ/σ + correlation) for the portfolio mode.
  const model = useMemo(
    () => estimatePortfolioModel(holdings, lookbackYears, histories),
    [holdings, lookbackYears, histories],
  );

  // The worker, the cache and the fallback are the same ones the FIRE planner
  // uses -- one runner, one cache key.
  const simulation = useMonteCarloRun();
  const { result, running } = simulation;
  const [scale, setScale] = useState<ChartScale>("log");
  const [hover, setHover] = useState<string | null>(null);
  // How the income is decided each year, and whether the losses are forced to
  // the front. What-if levers: live state, never persisted.
  const [withdrawalStrategy, setWithdrawalStrategy] = useState<WithdrawalStrategyId>("fixed");
  const [stress, setStress] = useState<StressScenario>("none");
  // In "My portfolio" mode the parameters are auto-derived; the user must opt in
  // to editing them.
  const [editing, setEditing] = useState(false);
  const locked = effectiveMode === "portfolio" && !editing;
  const [tourReplay, setTourReplay] = useState(0);

  function update<K extends keyof typeof form>(key: K, value: number) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function selectMode(next: SimMode) {
    setMode(next);
    // The horizon, the withdrawal phase and the contribution mean something
    // else per mode, so a mode switch drops overrides that were never typed
    // for this mode. Capital and μ/σ keep theirs: those the user set on
    // purpose, and the run button is right there to change them again.
    setForm((f) => ({
      ...f,
      years: null,
      withdrawalYears: null,
      monthlyContribution: null,
    }));
  }

  function resetToEstimates() {
    setReturnOverride(null);
    setVolOverride(null);
  }

  function run() {
    // A Pro-locked mode is previewed, never computed.
    if (modeLocked) return;
    const horizon = Math.max(1, Math.round(years));
    // Clamp to [1,000, 25,000] paths.
    const runs = Math.min(25000, Math.max(1000, Math.round(form.runs)));
    const drawYears = withdrawalAllowed ? Math.max(0, Math.round(withdrawalYears)) : 0;
    const drawRate = Math.max(0, withdrawalRate) / 100;
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
              years: horizon,
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
              withdrawalYears: drawYears,
              withdrawalRate: drawRate,
              rebalanceYearly,
              withdrawalStrategy,
              stress,
              inflation: Math.max(0, inflation) / 100,
              // The comparison is what says what the strategy choice costs, so
              // it is computed alongside rather than behind a second button.
              compareStrategies: drawYears > 0,
              ...(drawYears > 0 ? (appliedPension ?? {}) : {}),
            } satisfies PortfolioMonteCarloParams,
          }
        : {
            kind: "scalar" as const,
            params: {
              initialCapital,
              monthlyContribution: effectiveMonthlyContribution,
              years: horizon,
              expectedReturn: expectedReturn / 100,
              volatility: volatility / 100,
              runs,
              seed,
              withdrawalYears: drawYears,
              withdrawalRate: drawRate,
              withdrawalStrategy,
              stress,
              inflation: Math.max(0, inflation) / 100,
              compareStrategies: drawYears > 0,
              ...(drawYears > 0 ? (appliedPension ?? {}) : {}),
            } satisfies MonteCarloParams,
          };

    simulation.run(message);
  }

  const final = result?.bands[result.bands.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
      {holdings.length > 0 && <SimulationTour restartToken={tourReplay} />}
      <Card className="lg:sticky lg:top-6 self-start">
        <SectionTitle>
          {t("sim.parameters")}
          {holdings.length > 0 && <TourReplayButton onClick={() => setTourReplay((n) => n + 1)} />}
        </SectionTitle>

        {/* The model is what the ENTIRE panel below configures, so it is a tab
            strip at the top of the card rather than a toggle buried inside a
            "Model" section halfway down. A Pro-locked mode keeps its tab (with
            a padlock) and gates the panel as a whole — blurring only a
            fragment in the middle of the form read as a rendering glitch. */}
        {showModeToggle && (
          <Tabs
            dataTour="sim-model"
            className="mt-3"
            value={effectiveMode}
            onChange={selectMode}
            items={MODE_TABS.map(({ value, labelKey, feature }) => ({
              value,
              label: t(labelKey),
              locked: feature.locked,
            }))}
          />
        )}
        {showModeToggle && (
          <p className="mt-2 text-xs text-zinc-500">
            {effectiveMode === "portfolio"
              ? t("sim.modelPortfolioDesc")
              : t("sim.modelCustomDesc")}
          </p>
        )}
        {/* A horizon that arrived from the FIRE tab says so, because a number
            the user did not type has to name its source. */}
        {linkedYears != null && (
          <p className="mt-2 text-xs text-zinc-500">
            {t("sim.seededFromFire", { years: linkedYears })}
          </p>
        )}

        <ProGate
          locked={modeLocked}
          feature={effectiveMode === "portfolio" ? "simulationPortfolio" : "simulationCustom"}
        >
        <div className="mt-4 space-y-4">
          {/* Accumulation phase: initial capital, contribution, horizon. */}
          <div data-tour="sim-accumulation">
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
                isPrivate
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
                    <div
                      className="mt-1 text-sm font-semibold tabular-nums opacity-70"
                      data-private
                    >
                      {formatCurrency(monthlyFromPlans, currency)}
                    </div>
                  </div>
                ) : (
                  <SliderField
                    label={t("sim.monthlyContribution")}
                    suffix={currency}
                    value={monthlyContribution}
                    onChange={(v) => update("monthlyContribution", v)}
                    min={0}
                    max={5000}
                    step={50}
                    isPrivate
                  />
                )}
              </div>
              <SliderField
                label={t("sim.horizon")}
                suffix={t("sim.years")}
                value={years}
                onChange={(v) => update("years", v)}
                min={1}
                max={60}
                step={1}
              />
            </div>
          </div>

          {/* Withdrawal phase (feature-flagged decumulation). Pro-locked ⇒
              the real sliders stay on screen, blurred behind the teaser. */}
          {withdrawalFeature.enabled && (
            <ProGate locked={withdrawalFeature.locked} feature="simulationWithdrawal">
              <div data-tour="sim-withdrawal" className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {t("sim.withdrawalYears")}
                </h3>
                <div className="mt-3 space-y-3">
                  <SliderField
                    label={t("sim.withdrawalDuration")}
                    suffix={t("sim.years")}
                    value={withdrawalYears}
                    onChange={(v) => update("withdrawalYears", v)}
                    min={0}
                    max={40}
                    step={1}
                  />
                  {withdrawalYears > 0 && (
                    <div className="space-y-2">
                      <SliderField
                        label={t("sim.withdrawalRate")}
                        suffix="%"
                        value={withdrawalRate}
                        onChange={(v) => update("withdrawalRate", v)}
                        min={0}
                        max={10}
                        step={0.1}
                        digits={1}
                      />
                      <p className="text-xs text-zinc-500">{t("sim.withdrawalRateHint")}</p>
                    </div>
                  )}
                  {/* Guaranteed income shrinks what the portfolio has to pay,
                      so it belongs with the rate that decides the income. */}
                  {withdrawalYears > 0 && pension.bridge && (
                    <Toggle
                      checked={countPension}
                      onChange={setCountPensionOverride}
                      label={t("fire.pension.count")}
                      hint={t("fire.pension.hint", {
                        amount: formatCurrency(pension.monthly, currency),
                        year: String(pension.retirementYear),
                      })}
                      hintPrivate
                    />
                  )}
                  {/* The rate says how much; the strategy says how that amount
                      is decided again each year, and the stress says what it is
                      being tested against. Same panel as the FIRE tab. */}
                  {withdrawalYears > 0 && (
                    <>
                      <SliderField
                        label={t("sim.inflation")}
                        suffix="%"
                        value={inflation}
                        onChange={(v) => update("inflation", v)}
                        min={0}
                        max={8}
                        step={0.1}
                        digits={1}
                      />
                      <p className="text-xs text-zinc-500">{t("sim.inflationHint")}</p>
                      <WithdrawalStrategyPanel
                        strategy={withdrawalStrategy}
                        onStrategy={setWithdrawalStrategy}
                      />
                    </>
                  )}
                </div>
              </div>
            </ProGate>
          )}

          {/* Assumptions of the selected model, rebalancing (a property of the
              portfolio model) and the run count. The model CHOICE itself is
              the tab strip at the top of the card. */}
          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t("sim.model")}
              </h3>
              <InfoTip text={t("sim.guidelinesTip")} />
            </div>
            <div className="mt-3 space-y-4">
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
                  <InfoTip text={t("sim.rebalanceYearlyTip")} />
                </label>
              )}

              {/* A forced bad sequence is a property of the market, so it
                  applies to every run, drawdown or not. */}
              <StressPicker stress={stress} onStress={setStress} />

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

          <Button
            variant="primary"
            className="w-full"
            onClick={run}
            disabled={running || modeLocked}
          >
            {running ? t("sim.running") : t("sim.run")}
          </Button>
        </div>
        </ProGate>
      </Card>

      <div className="space-y-6 min-w-0">
        {result && final ? (
          <>
            {/* The projection band comes first: the shape of the outcome is
                what the run is for, and the headline figures read off it. */}
            <Card data-tour="sim-chart">
              <SectionTitle
                actions={
                  <>
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
                  </>
                }
              >
                {t("sim.projectedWealth")}
              </SectionTitle>
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

            <StatRow cols={3}>
              <Stat
                label={t("sim.medianWealth")}
                value={formatCurrency(final.median, currency)}
                sub={`${result.params.years} ${t("sim.years")}`}
                info={t("sim.tipMedian")}
                isPrivate
              />
              <Stat
                label={t("sim.optimistic")}
                value={formatCurrency(final.p90, currency)}
                valueClassName={plColor(1)}
                info={t("sim.tipOptimistic")}
                isPrivate
              />
              <Stat
                label={t("sim.pessimistic")}
                value={formatCurrency(final.p10, currency)}
                valueClassName={plColor(-1)}
                info={t("sim.tipPessimistic")}
                isPrivate
              />
            </StatRow>

            {/* Decumulation: how much this plan lets you draw each year/month. */}
            {result.withdrawal && (
              <Card>
                <SectionTitle info={t("sim.withdrawalMetricsTip")}>
                  {t("sim.withdrawalTitle")}
                </SectionTitle>
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
                {/* The figures above are the whole income the plan pays. Once
                    the pension starts, part of it is not the portfolio's job. */}
                {(result.params.annualPensionIncome ?? 0) > 0 && (
                  <p className="mt-3 text-xs text-zinc-500" data-private>
                    {t("sim.withdrawalPensionNote", {
                      amount: formatCurrency(result.params.annualPensionIncome ?? 0, currency),
                      year: String(
                        new Date().getFullYear() + Math.round(result.params.pensionYearsUntilStart ?? 0),
                      ),
                    })}
                  </p>
                )}
              </Card>
            )}

            {/* What the strategy choice actually costs, right under what the
                chosen one pays. */}
            {result.strategyComparison && (
              <WithdrawalComparison
                comparison={result.strategyComparison}
                strategy={withdrawalStrategy}
                currency={currency}
              />
            )}
          </>
        ) : (
          <Card data-tour="sim-chart">
            <EmptyState
              title={t("sim.configurePrompt")}
              hint={t("sim.configureHint")}
            />
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

  const [adv, setAdv] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const hasOverrides = Object.values(overrides).some((o) => o.mean != null || o.vol != null);

  // Weight-weighted summary of the effective (override-aware) per-asset
  // figures, shown as a single line while the per-asset list is collapsed.
  const totalWeight = model.assets.reduce((s, a) => s + a.weight, 0) || 1;
  const weightedMean =
    model.assets.reduce((s, a) => {
      const o = overrides[a.name];
      const effMean = o?.mean != null ? o.mean / 100 : a.mean;
      return s + effMean * a.weight;
    }, 0) / totalWeight;
  const weightedVol =
    model.assets.reduce((s, a) => {
      const o = overrides[a.name];
      const effVol = o?.vol != null ? o.vol / 100 : a.vol;
      return s + effVol * a.weight;
    }, 0) / totalWeight;

  return (
    <div className="rounded-lg border border-zinc-200 p-3.5 text-xs dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2 text-zinc-700 dark:text-zinc-200">
        <span className="font-semibold">{t("sim.perAssetModel")}</span>
        <span className="text-right text-[11px] font-medium text-zinc-500">
          {pureGuess
            ? t("sim.estimate")
            : blended
              ? t("sim.blended")
              : t("sim.yrsHistory", { years: model.sampleYears.toFixed(1) })}
        </span>
      </div>

      {pureGuess ? (
        <InlineNotice variant="warning" className="mt-2">
          {t("sim.pureGuessNote")}
        </InlineNotice>
      ) : blended ? (
        <InlineNotice variant="info" className="mt-2">
          {t("sim.blendedNote")}
        </InlineNotice>
      ) : null}

      {showAssets ? (
        <>
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
                        className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
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
        </>
      ) : (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {t("sim.modelSummary", {
            count: String(model.assets.length),
            ret: formatPercent(weightedMean),
            vol: pct(weightedVol),
          })}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowAssets((v) => !v)}
        className="mt-2 text-[11px] font-medium text-indigo-700 hover:underline dark:text-indigo-300"
      >
        {showAssets ? t("sim.hideModelDetails") : t("sim.showModelDetails")}
      </button>
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
  const [draft, setDraft] = useState(() => formatInputDecimal(value));
  const [dirty, setDirty] = useState(false);

  function handleChange(raw: string) {
    const localized = stripLeadingZero(raw);
    setDraft(localized);
    setDirty(true);
    const parsed = parseDecimal(localized);
    if (Number.isFinite(parsed)) onChange(parsed);
  }

  return (
    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span className="shrink-0">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        step="0.1"
        value={dirty ? draft : formatInputDecimal(value)}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setDirty(false)}
        className="w-full min-w-0 rounded-sm border border-zinc-300 bg-white/60 px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
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
    <InlineNotice
      variant="info"
      title={t("sim.customAssumptions")}
      action={
        !usingEstimates ? (
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t("sim.resetToDefaults", {
              ret: CUSTOM_RETURN_DEFAULT,
              vol: CUSTOM_VOL_DEFAULT,
            })}
          </Button>
        ) : undefined
      }
    >
      {t("sim.customAssumptionsNote", {
        ret: CUSTOM_RETURN_DEFAULT,
        vol: CUSTOM_VOL_DEFAULT,
      })}
    </InlineNotice>
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
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName}`} data-private>
        {formatCurrency(annual, currency)}
        <span className="ml-1 text-sm font-normal text-zinc-400">/{t("sim.perYear")}</span>
      </div>
      <div className="mt-0.5 text-sm tabular-nums text-zinc-500" data-private>
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
        <div className="font-medium tabular-nums" data-private>{formatCurrency(contributed, currency)}</div>
      </div>
      <div>
        <div className="text-zinc-500">{t("sim.growth")}</div>
        <div className={`font-medium tabular-nums ${plColor(growth)}`} data-private>
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
  isPrivate = false,
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
  /** Blur the shown figure in Incognito mode (absolute money only). */
  isPrivate?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => formatInputDecimal(value, digits));
  const [dirty, setDirty] = useState(false);
  const display = formatInputDecimal(value, digits);

  function handleManualChange(raw: string) {
    const localized = stripLeadingZero(raw);
    setDraft(localized);
    setDirty(true);
    const parsed = parseDecimal(localized);
    if (Number.isFinite(parsed)) onChange(parsed);
  }

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
        <div
          className="mt-1 text-sm font-semibold tabular-nums opacity-70"
          data-private={isPrivate || undefined}
        >
          {display}
          {suffix ? <span className="ml-1 text-xs font-normal text-zinc-400">{suffix}</span> : null}
        </div>
      </div>
    );
  }

  // The precise value is a numeric field wired to the same value as the
  // slider (§12.3): drag the track or type an exact figure, both edit one
  // state. No separate "enter value" mode to toggle.
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        {lockBtn}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1">
          <Slider min={min} max={max} step={step} value={value} onChange={onChange} aria-label={label} />
        </div>
        <div className="flex w-28 shrink-0 items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            value={dirty ? draft : display}
            onChange={(e) => handleManualChange(e.target.value)}
            onBlur={() => setDirty(false)}
            aria-label={label}
            data-private={isPrivate || undefined}
            className="w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-right text-sm font-medium tabular-nums outline-none transition-colors focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {suffix ? <span className="shrink-0 text-xs text-zinc-400">{suffix}</span> : null}
        </div>
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
      className="inline-flex cursor-default items-center gap-1.5 rounded-sm px-1 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
