"use client";

// Retirement / FIRE planner (ROADMAP #8, flag `firePlanner`): reframes the
// existing Monte Carlo engine (lib/finance/monte-carlo.ts) and measured
// return/volatility estimator (lib/finance/stats.ts) as a goal -- lean/
// regular/fat FIRE numbers and years-to-FI, computed instantly client-side
// (lib/finance/fire.ts, pure), plus an optional full worker-run Monte Carlo
// simulation seeded from the chosen FIRE target and withdrawal rate. The
// worker invocation + param-hash caching mirrors
// components/simulation/monte-carlo-panel.tsx exactly (same
// loadSimulation/saveSimulation seam via usePortfolio()); the result is
// rendered with the same DistributionChart the /simulation page uses, plus
// a plain success-probability summary (share of runs where the balance
// never hit zero across the withdrawal years) rather than duplicating that
// page's full per-asset model UI -- an honestly-scoped MVP rather than a
// second full simulation control panel.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { today } from "@/lib/finance/dates";
import { accountsValueOn } from "@/lib/finance/accounts";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { portfolioTotals, summarizeAll } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { portfolioOrBenchmarkStats } from "@/lib/finance/stats";
import { monthlyContributionOf } from "@/lib/finance/savings-plans";
import {
  computeFirePlan,
  trailingAnnualExpenses,
  FAT_FIRE_EXPENSE_RATIO,
  LEAN_FIRE_EXPENSE_RATIO,
  type PensionBridge,
} from "@/lib/finance/fire";
import { projectPension } from "@/lib/finance/pension";
import { usePensionReference } from "@/lib/pension/use-pension-reference";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { randomSeed, useMonteCarloRun } from "@/lib/simulation/use-monte-carlo";
import type { StressScenario, WithdrawalStrategyId } from "@/lib/finance/withdrawal";
import {
  WithdrawalComparison,
  WithdrawalStrategyPanel,
} from "@/components/simulation/withdrawal-strategy-panel";
import { formatCurrency, formatPercent, formatPercentPlain } from "@/lib/format";
import { Button, Card, Stat, Toggle } from "@/components/ui/primitives";
import { Private } from "@/components/ui/private";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import { DistributionChart } from "@/components/charts/distribution-chart";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

// Default withdrawal rate: the classic "4% rule".
const DEFAULT_WITHDRAWAL_RATE = 4;
// Historical lookback/horizon for the return estimate: FIRE planning is a
// long-run (decade-plus) horizon, so this leans further on stats.ts's
// regression-to-mean toward the long-run capital-market assumption than the
// general simulator's default (which couples the lookback to the
// user-chosen accumulation horizon).
const RETURN_HORIZON_YEARS = 20;
// Conventional retirement duration the withdrawal phase simulates -- the
// same span the "4% rule" (Trinity study) was calibrated against.
const RETIREMENT_WITHDRAWAL_YEARS = 30;
const SIMULATION_RUNS = 5000;

function formatYears(years: number | null, t: T): string {
  if (years === null) return t("fire.never");
  if (years === 0) return t("fire.alreadyThere");
  return t("fire.yearsToFi", { years: years.toFixed(1) });
}

export function FireView() {
  const { data } = usePortfolio();
  // The worker, the cache and the fallback are the same ones /simulation uses.
  const simulation = useMonteCarloRun();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const currency = data.profile.currency;
  const todayIso = today();

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation)
        .filter((h) => h.position.shares > 0)
        .map((h) => ({ asset: h.asset, marketValue: h.marketValue })),
    [data.assets, data.transactions, valuation],
  );

  // Same net-worth figure as the dashboard hero / /health: holdings market
  // value plus the signed sum of every balance account.
  const movements = useAccountMovements();

  const netWorth = useMemo(() => {
    const totals = portfolioTotals(summarizeAll(data.assets, data.transactions, valuation));
    const accountsNet = accountsValueOn(
      data.accounts,
      data.accountBalances,
      todayIso,
      valuation,
      movements,
    );
    return totals.marketValue + accountsNet;
  }, [
    data.assets,
    data.transactions,
    data.accounts,
    data.accountBalances,
    valuation,
    todayIso,
    movements,
  ]);

  const autoAnnualExpenses = useMemo(
    () => trailingAnnualExpenses(data.spendingTransactions, todayIso),
    [data.spendingTransactions, todayIso],
  );
  const hasExpenseData = autoAnnualExpenses > 0;

  const autoMonthlyContribution = useMemo(
    () => monthlyContributionOf(data.savingsPlans, data.assets, valuation),
    [data.savingsPlans, data.assets, valuation],
  );

  // Real history feeds the measured return estimate, same source as the
  // general simulator (components/simulation/monte-carlo-panel.tsx).
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
  const stats = useMemo(
    () => portfolioOrBenchmarkStats(holdings, RETURN_HORIZON_YEARS, histories),
    [holdings, histories],
  );

  // Editable overrides -- default to the measured/derived figures, user can
  // adjust any of them; recomputes live client-side, no worker involved.
  // The pension is not a neighbouring feature, it is an input to this one:
  // guaranteed income from a fixed year is capital you never have to
  // accumulate. Same projection the Pension tab shows, so the two tabs cannot
  // disagree about the figure.
  const pensionReference = usePensionReference();
  const pensionEnabled = useFeatureFlag("pension");
  const projection = useMemo(
    () =>
      projectPension({
        entries: data.pensionPoints,
        statements: data.pensionStatements,
        contracts: data.pensionContracts,
        reference: pensionReference,
        settings: data.profile.pensionSettings,
        currentYear: Number(todayIso.slice(0, 4)),
      }),
    [
      data.pensionPoints,
      data.pensionStatements,
      data.pensionContracts,
      data.profile.pensionSettings,
      pensionReference,
      todayIso,
    ],
  );
  // Without a Rentenwert the statutory half cannot be valued, so only the
  // private policies count -- the same "report what is known, invent nothing"
  // rule the Pension tab follows.
  const pensionMonthly = projection.monthlyTotal ?? projection.monthlyPrivate;
  const pensionBridge: PensionBridge | undefined =
    pensionEnabled && projection.retirementYear != null && pensionMonthly > 0
      ? {
          annualIncome: pensionMonthly * 12,
          yearsUntilStart: Math.max(0, projection.retirementYear - Number(todayIso.slice(0, 4))),
        }
      : undefined;
  const [countPension, setCountPension] = useState(true);
  const appliedPension = countPension ? pensionBridge : undefined;

  const [withdrawalRatePercent, setWithdrawalRatePercent] = useState(DEFAULT_WITHDRAWAL_RATE);
  // How the income is decided each year, and whether the losses are forced to
  // the front. Both are what-if levers: live state, never persisted.
  const [withdrawalStrategy, setWithdrawalStrategy] = useState<WithdrawalStrategyId>("fixed");
  const [stress, setStress] = useState<StressScenario>("none");
  const [expensesOverride, setExpensesOverride] = useState<number | null>(null);
  const [contributionOverride, setContributionOverride] = useState<number | null>(null);
  const [returnOverride, setReturnOverride] = useState<number | null>(null);

  const effectiveExpenses = expensesOverride ?? autoAnnualExpenses;
  const effectiveContribution = contributionOverride ?? autoMonthlyContribution;
  const effectiveReturnPercent = returnOverride ?? Math.round(stats.expectedReturn * 1000) / 10;

  const plan = useMemo(
    () =>
      computeFirePlan(
        netWorth,
        effectiveExpenses,
        effectiveContribution,
        effectiveReturnPercent / 100,
        withdrawalRatePercent / 100,
        appliedPension,
      ),
    [
      netWorth,
      effectiveExpenses,
      effectiveContribution,
      effectiveReturnPercent,
      withdrawalRatePercent,
      appliedPension,
    ],
  );

  // Each tile says in words what its number IS: the budget it funds and the
  // rate it funds it at. A bare euro amount is unreadable without them.
  function basisFor(expenseRatio: number): string {
    const rate = formatPercentPlain(withdrawalRatePercent / 100, 1);
    if (expenseRatio === 1) {
      return t("fire.tile.basis", { expenses: formatCurrency(effectiveExpenses, currency), rate });
    }
    return t("fire.tile.basisRatio", {
      ratio: formatPercentPlain(expenseRatio, 0),
      expenses: formatCurrency(effectiveExpenses * expenseRatio, currency),
      rate,
    });
  }

  // With the pension counted the target is NOT expenses/rate any more, so the
  // basis line would otherwise describe arithmetic the number does not follow.
  const pensionNote =
    appliedPension && projection.retirementYear != null
      ? t("fire.tile.pensionApplied", { year: String(projection.retirementYear) })
      : undefined;

  // --- Full worker-run Monte Carlo, seeded from the chosen FIRE target. ---
  const { result, running } = simulation;

  function runSimulation() {
    const accumulationYears = Math.max(
      1,
      Math.min(80, Math.ceil(plan.yearsToRegular ?? RETIREMENT_WITHDRAWAL_YEARS)),
    );
    simulation.run({
      kind: "scalar",
      params: {
        initialCapital: Math.max(0, Math.round(netWorth)),
        monthlyContribution: Math.max(0, effectiveContribution),
        years: accumulationYears,
        expectedReturn: effectiveReturnPercent / 100,
        volatility: stats.volatility,
        runs: SIMULATION_RUNS,
        seed: randomSeed(),
        withdrawalYears: RETIREMENT_WITHDRAWAL_YEARS,
        withdrawalRate: withdrawalRatePercent / 100,
        withdrawalStrategy,
        stress,
        // The comparison is the point of the strategy picker: it is what says
        // what the choice costs, so it is always computed alongside.
        compareStrategies: true,
      },
    });
  }

  const successProbability =
    result && result.finalDistribution.length > 0
      ? result.finalDistribution.filter((v) => v > 0).length / result.finalDistribution.length
      : null;
  const medianFinal = result?.bands[result.bands.length - 1]?.median ?? null;

  return (
    <div className="space-y-6">
      <Card data-tour="fire-inputs">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Stat label={t("fire.netWorth.label")} value={formatCurrency(netWorth, currency)} isPrivate />
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-sm font-medium">{t("fire.withdrawalRate.label")}</label>
              <span className="text-sm font-semibold tabular-nums">
                {withdrawalRatePercent.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2">
              <Slider
                min={2}
                max={8}
                step={0.1}
                value={withdrawalRatePercent}
                onChange={setWithdrawalRatePercent}
                aria-label={t("fire.withdrawalRate.label")}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">{t("fire.withdrawalRate.hint")}</p>
          </div>
        </div>

        {/* What the pension is worth to this plan, in one line. A user who has
            never opened the Pension tab is told the number is missing rather
            than silently getting the pension-free target. */}
        {pensionEnabled && (
          <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            {pensionBridge ? (
              <>
                <Toggle
                  checked={countPension}
                  onChange={setCountPension}
                  label={t("fire.pension.count")}
                  hint={t("fire.pension.hint", {
                    amount: formatCurrency(pensionMonthly, currency),
                    year: String(projection.retirementYear),
                  })}
                />
                {countPension && plan.regularWithoutPension > plan.regular && (
                  <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                    {t("fire.pension.saves", {
                      without: formatCurrency(plan.regularWithoutPension, currency),
                      with: formatCurrency(plan.regular, currency),
                      years: String(Math.round(plan.bridgeYears)),
                    })}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-500">{t("fire.pension.missing")}</p>
            )}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            label={t("fire.annualExpenses.label")}
            suffix={currency}
            value={effectiveExpenses}
            onChange={setExpensesOverride}
          />
          <NumberField
            label={t("fire.monthlyContribution.label")}
            suffix={currency}
            value={effectiveContribution}
            onChange={setContributionOverride}
          />
          <NumberField
            label={t("fire.annualReturn.label")}
            suffix="%"
            value={effectiveReturnPercent}
            onChange={setReturnOverride}
            step={0.1}
          />
        </div>
        {!hasExpenseData && expensesOverride === null && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{t("fire.noExpenseData")}</p>
        )}
        <p className="mt-1 text-xs text-zinc-500">{t("fire.annualReturn.hint")}</p>
      </Card>

      <div data-tour="fire-targets">
        <h2 className="text-lg font-semibold">{t("fire.targets.title")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("fire.targets.subtitle")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FireTile
            label={t("fire.lean.label")}
            info={t("fire.lean.info", { ratio: formatPercentPlain(LEAN_FIRE_EXPENSE_RATIO, 0) })}
            basis={basisFor(LEAN_FIRE_EXPENSE_RATIO)}
            pensionNote={pensionNote}
            amount={plan.lean}
            years={plan.yearsToLean}
            currency={currency}
            t={t}
          />
          <FireTile
            label={t("fire.regular.label")}
            info={t("fire.regular.info")}
            basis={basisFor(1)}
            pensionNote={pensionNote}
            amount={plan.regular}
            years={plan.yearsToRegular}
            currency={currency}
            t={t}
          />
          <FireTile
            label={t("fire.fat.label")}
            info={t("fire.fat.info", { ratio: formatPercentPlain(FAT_FIRE_EXPENSE_RATIO, 0) })}
            basis={basisFor(FAT_FIRE_EXPENSE_RATIO)}
            pensionNote={pensionNote}
            amount={plan.fat}
            years={plan.yearsToFat}
            currency={currency}
            t={t}
          />
        </div>
      </div>

      <Card data-tour="fire-simulation">
        <h2 className="text-lg font-semibold">{t("fire.simulation.title")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("fire.simulation.subtitle")}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {t("fire.simulation.withdrawalYearsNote", { years: String(RETIREMENT_WITHDRAWAL_YEARS) })}
        </p>
        {/* The strategy and the stress belong WITH the run button: they are
            what the run is testing, not a reading of its result. */}
        <div className="mt-4">
          <WithdrawalStrategyPanel
            strategy={withdrawalStrategy}
            onStrategy={setWithdrawalStrategy}
            stress={stress}
            onStress={setStress}
          />
        </div>

        <div className="mt-4">
          <Button variant="primary" onClick={runSimulation} disabled={running}>
            {running ? t("fire.simulation.running") : t("fire.simulation.run")}
          </Button>
        </div>

        {result ? (
          <div className="mt-6 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <Stat
                  label={t("fire.simulation.medianFinal")}
                  value={medianFinal !== null ? formatCurrency(medianFinal, currency) : "-"}
                  isPrivate
                />
              </Card>
              <Card>
                <Stat
                  label={t("fire.simulation.successProbability")}
                  value={successProbability !== null ? formatPercent(successProbability) : "-"}
                  sub={t("fire.simulation.successHint")}
                />
              </Card>
            </div>
            {result.strategyComparison && (
              <WithdrawalComparison
                comparison={result.strategyComparison}
                strategy={withdrawalStrategy}
                currency={currency}
              />
            )}
            <DistributionChart
              result={result}
              currency={currency}
              scale="log"
              phaseBoundaryYear={result.params.withdrawalYears ? result.params.years : undefined}
            />
          </div>
        ) : (
          <div className="mt-6 flex h-40 items-center justify-center text-center text-sm text-zinc-500">
            {t("fire.simulation.configurePrompt")}
          </div>
        )}
      </Card>
    </div>
  );
}

function FireTile({
  label,
  info,
  basis,
  pensionNote,
  amount,
  years,
  currency,
  t,
}: {
  label: string;
  /** What this target means, on the label's ⓘ. */
  info: string;
  /** How this number was derived, always visible: the tooltip cannot be the
   *  only explanation on a phone. */
  basis: string;
  pensionNote?: string;
  amount: number;
  years: number | null;
  currency: string;
  t: T;
}) {
  return (
    <Card>
      <Stat
        label={label}
        info={info}
        value={Number.isFinite(amount) ? formatCurrency(amount, currency) : "-"}
        sub={formatYears(years, t)}
        isPrivate
      />
      <p className="mt-3 text-xs leading-snug text-zinc-500">
        <Private>{basis}</Private>
        {pensionNote && <span className="block">{pensionNote}</span>}
      </p>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="group relative mt-1">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`w-full rounded-md border border-zinc-300 bg-transparent py-2 pl-3 text-sm tabular-nums outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:focus:border-zinc-300 dark:focus:ring-white/10 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
            suffix ? "pr-12" : "pr-3"
          }`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}
