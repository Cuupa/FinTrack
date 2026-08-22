"use client";

// Retirement / FIRE planner (ROADMAP #8, flag `firePlanner`): the measured
// return/volatility estimator (lib/finance/stats.ts) reframed as a goal --
// lean/regular/fat FIRE numbers and years-to-FI, computed instantly
// client-side (lib/finance/fire.ts, pure).
//
// The Monte Carlo is NOT here. This page used to carry its own run button,
// stat tiles, strategy panel and distribution chart, which meant the app
// offered two simulations of the same question with two sets of controls.
// It now links into the simulator's "Ruhestand" mode, and both surfaces read
// the same figures from `useFireInputs` so the plan and the simulation of it
// can never disagree.

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import {
  computeFirePlan,
  shortfallRisk,
  FAT_FIRE_EXPENSE_RATIO,
  LEAN_FIRE_EXPENSE_RATIO,
  RETIREMENT_YEARS,
} from "@/lib/finance/fire";
import { useFireInputs } from "@/lib/fire/use-fire-inputs";
import {
  annualAmountOf,
  defaultWithdrawalPlan,
  rateOf,
  type WithdrawalPlan,
} from "@/lib/finance/withdrawal-plan";
import { WithdrawalStrategyPanel } from "@/components/simulation/withdrawal-strategy-panel";
import { formatCurrency, formatInputDecimal, formatPercentPlain, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Card, SectionTitle, Stat, Toggle } from "@/components/ui/primitives";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Private } from "@/components/ui/private";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

function formatYears(years: number | null, t: T): string {
  if (years === null) return t("fire.never");
  if (years === 0) return t("fire.alreadyThere");
  return t("fire.yearsToFi", { years: years.toFixed(1) });
}

export function FireView() {
  const { data } = usePortfolio();
  const { t } = useI18n();
  const currency = data.profile.currency;

  // Real history feeds the measured return estimate, same source as the
  // general simulator (components/simulation/monte-carlo-panel.tsx).
  const { version } = useCatalog();
  const { valuation } = useLivePrices();
  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );
  const histItems = useMemo(
    () =>
      holdings
        .map((h) => quoteItemFor(h.asset))
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, version],
  );
  const { histories } = useHistory(histItems, "MAX", currency);

  // Net worth, expenses, contribution, measured return and the pension bridge:
  // the same figures the simulator's Ruhestand mode runs on.
  const fire = useFireInputs(histories);

  const [countPension, setCountPension] = useState(true);
  const appliedPension = countPension ? fire.pensionBridge : undefined;

  // The withdrawal assumption: FIRE sizes the target from it, and the same
  // plan seeds the simulation on hand-off (§7.3) -- one assumption, not two
  // independent sliders. Default reproduces the old 4% behaviour exactly.
  const [withdrawalPlan, setWithdrawalPlan] = useState<WithdrawalPlan>(defaultWithdrawalPlan);
  // Editable overrides -- default to the measured/derived figures, user can
  // adjust any of them; recomputes live client-side, no worker involved.
  const [expensesOverride, setExpensesOverride] = useState<number | null>(null);
  const [contributionOverride, setContributionOverride] = useState<number | null>(null);
  const [returnOverride, setReturnOverride] = useState<number | null>(null);

  const netWorth = fire.netWorth;
  const hasExpenseData = fire.hasExpenseData;
  const effectiveExpenses = expensesOverride ?? fire.annualExpenses;
  const effectiveContribution = contributionOverride ?? fire.monthlyContribution;
  const effectiveReturnPercent = returnOverride ?? Math.round(fire.expectedReturn * 1000) / 10;

  // The pension toggle layers onto the SAME plan object the strategy panel
  // edits -- guaranteed income is part of the plan, not a second state next
  // to it (WITHDRAWAL_REFACTOR_PLAN.md §10).
  const planWithPension: WithdrawalPlan = useMemo(
    () => ({
      ...withdrawalPlan,
      guaranteedIncome: appliedPension
        ? { annualAmount: appliedPension.annualIncome, yearsUntilStart: appliedPension.yearsUntilStart }
        : undefined,
    }),
    [withdrawalPlan, appliedPension],
  );

  const plan = useMemo(
    () =>
      computeFirePlan(
        netWorth,
        effectiveExpenses,
        effectiveContribution,
        effectiveReturnPercent / 100,
        planWithPension,
      ),
    [netWorth, effectiveExpenses, effectiveContribution, effectiveReturnPercent, planWithPension],
  );

  // What the portfolio actually has to fund: the full need until the pension
  // starts (bridge years), only the shortfall once it is flowing.
  const need =
    withdrawalPlan.strategy === "fixedRealAmount"
      ? (annualAmountOf(withdrawalPlan) ?? 0)
      : effectiveExpenses;
  const guaranteedAnnual = planWithPension.guaranteedIncome?.annualAmount ?? 0;
  const remainingNeed = Math.max(0, need - guaranteedAnnual);
  const firstYearWithdrawal = plan.bridgeYears > 0 ? need : remainingNeed;

  // Each tile says in words what its number IS: the budget it funds and the
  // rate/amount it funds it at. A bare euro amount is unreadable without them.
  function basisFor(ratio: number): string {
    if (withdrawalPlan.strategy === "fixedRealAmount") {
      return t("fire.tile.basisAmount", {
        amount: formatCurrency((annualAmountOf(withdrawalPlan) ?? 0) * ratio, currency),
      });
    }
    const rate = formatPercentPlain(rateOf(withdrawalPlan) ?? 0, 1);
    if (ratio === 1) {
      return t("fire.tile.basis", { expenses: formatCurrency(effectiveExpenses, currency), rate });
    }
    return t("fire.tile.basisRatio", {
      ratio: formatPercentPlain(ratio, 0),
      expenses: formatCurrency(effectiveExpenses * ratio, currency),
      rate,
    });
  }

  // With the pension counted the target is NOT expenses/rate any more, so the
  // basis line would otherwise describe arithmetic the number does not follow.
  // What the chosen strategy costs in risk. A higher rate/lower amount lowers
  // every target, which reads as nonsense until the failure rate it buys sits
  // next to it. The risk sim must run the ACTUAL chosen strategy, not a
  // strategy hardcoded independently of the user's choice (§3.11).
  const risk = useMemo(
    () => ({
      lean: shortfallRisk({
        target: plan.lean,
        expectedReturn: effectiveReturnPercent / 100,
        volatility: fire.volatility,
        plan: planWithPension,
      }),
      regular: shortfallRisk({
        target: plan.regular,
        expectedReturn: effectiveReturnPercent / 100,
        volatility: fire.volatility,
        plan: planWithPension,
      }),
      fat: shortfallRisk({
        target: plan.fat,
        expectedReturn: effectiveReturnPercent / 100,
        volatility: fire.volatility,
        plan: planWithPension,
      }),
    }),
    [plan.lean, plan.regular, plan.fat, effectiveReturnPercent, fire.volatility, planWithPension],
  );

  const pensionNote =
    appliedPension && fire.retirementYear != null
      ? t("fire.tile.pensionApplied", { year: String(fire.retirementYear) })
      : undefined;

  // The plan hands over WHOLE: strategy, rate/amount, inflation -- not just
  // the horizon and the pension flag it used to (§7.3/§3.8). The simulation
  // treats every field as a startING point it can still edit.
  const simulationParams = new URLSearchParams({
    years: String(Math.max(1, Math.min(80, Math.ceil(plan.yearsToRegular ?? 30)))),
    withdrawal: "30",
    strategy: withdrawalPlan.strategy,
    inflation: String(withdrawalPlan.inflation.assumedRate),
  });
  if (withdrawalPlan.amount.kind === "rate") {
    simulationParams.set("rate", String(withdrawalPlan.amount.value));
  } else {
    simulationParams.set(
      "amount",
      String(annualAmountOf(withdrawalPlan) ?? 0),
    );
  }
  if (appliedPension) {
    simulationParams.set("pensionAnnual", String(appliedPension.annualIncome));
    simulationParams.set("pensionStart", String(appliedPension.yearsUntilStart));
  }

  return (
    <div className="space-y-6">
      <Card data-tour="fire-inputs">
        <Stat label={t("fire.netWorth.label")} value={formatCurrency(netWorth, currency)} isPrivate />

        <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <WithdrawalStrategyPanel plan={withdrawalPlan} onPlanChange={setWithdrawalPlan} currency={currency} />
        </div>

        {/* What the pension is worth to this plan, in one line. A user who has
            never opened the Pension tab is told the number is missing rather
            than silently getting the pension-free target. */}
        {fire.pensionEnabled && (
          <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            {fire.pensionBridge ? (
              <>
                <Toggle
                  checked={countPension}
                  onChange={setCountPension}
                  label={t("fire.pension.count")}
                  hint={t("fire.pension.hint", {
                    amount: formatCurrency(fire.pensionMonthly, currency),
                    year: String(fire.retirementYear),
                  })}
                  hintPrivate
                />
                {countPension && plan.regularWithoutPension > plan.regular && (
                  <div className="mt-2 space-y-1" data-private>
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">
                      {t("fire.pension.saves", {
                        without: formatCurrency(plan.regularWithoutPension, currency),
                        with: formatCurrency(plan.regular, currency),
                      })}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {t("fire.pension.bridge", { years: String(Math.round(plan.bridgeYears)) })}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <InlineNotice variant="info">{t("fire.pension.missing")}</InlineNotice>
            )}
          </div>
        )}

        {/* What the plan means in figures the user can check against their
            own budget: first year, monthly equivalent, what the pension
            covers, and what is left for the portfolio
            (WITHDRAWAL_REFACTOR_PLAN.md §9.4). */}
        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:grid-cols-2" data-private>
          <Stat
            label={t("fire.summary.firstYear")}
            value={formatCurrency(firstYearWithdrawal, currency)}
            sub={t("fire.summary.perMonth", { amount: formatCurrency(firstYearWithdrawal / 12, currency) })}
          />
          {guaranteedAnnual > 0 ? (
            <Stat
              label={t("fire.summary.remainingNeed")}
              value={formatCurrency(remainingNeed, currency)}
              sub={t("fire.summary.guaranteedIncome", { amount: formatCurrency(guaranteedAnnual, currency) })}
            />
          ) : (
            <Stat label={t("fire.summary.remainingNeed")} value={formatCurrency(need, currency)} />
          )}
        </div>
        {!plan.hasStableTarget && (
          <div className="mt-3">
            <InlineNotice variant="info">{t("fire.summary.noStableTarget")}</InlineNotice>
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
          <div className="mt-3">
            <InlineNotice variant="warning">{t("fire.noExpenseData")}</InlineNotice>
          </div>
        )}
        <p className="mt-1 text-xs text-zinc-500">{t("fire.annualReturn.hint")}</p>
      </Card>

      <div data-tour="fire-targets">
        <SectionTitle>{t("fire.targets.title")}</SectionTitle>
        <p className="mt-1 text-sm text-zinc-500">{t("fire.targets.subtitle")}</p>
        {(risk.lean !== null || risk.regular !== null || risk.fat !== null) && (
          <div className="mt-3">
            <InlineNotice variant="info">
              {t("fire.risk.shared", { years: RETIREMENT_YEARS })}
            </InlineNotice>
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FireTile
            label={t("fire.lean.label")}
            info={t("fire.lean.info", { ratio: formatPercentPlain(LEAN_FIRE_EXPENSE_RATIO, 0) })}
            basis={basisFor(LEAN_FIRE_EXPENSE_RATIO)}
            pensionNote={pensionNote}
            amount={plan.lean}
            years={plan.yearsToLean}
            risk={risk.lean}
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
            risk={risk.regular}
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
            risk={risk.fat}
            currency={currency}
            t={t}
          />
        </div>
      </div>

      {/* The simulation itself lives on /simulation. This page had grown a
          second one -- its own run button, tiles, strategy panel and chart --
          so the app asked the same question twice with two sets of controls.
          Years-to-FI is simply the investment horizon, so the link hands it
          over as exactly that, with the drawdown phase switched on. */}
      <Card data-tour="fire-simulation">
        <SectionTitle>{t("fire.simulation.title")}</SectionTitle>
        <p className="mt-1 text-sm text-zinc-500">{t("fire.simulation.movedHint")}</p>
        <div className="mt-4">
          <Link
            href={`/simulation?${simulationParams.toString()}`}
            className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("fire.simulation.open")}
          </Link>
        </div>
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
  risk,
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
  /** Share of simulated retirements that run out at this target and rate. */
  risk: number | null;
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
      {/* Status only: the shared notice above the cards explains what it means
          and the lever, so the sentence is not repeated three times. */}
      {risk !== null && (
        <p
          className={`mt-2 text-xs font-medium ${
            risk >= 0.2
              ? "text-red-600 dark:text-red-400"
              : risk >= 0.1
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {t("fire.tile.riskShort", { risk: formatPercentPlain(risk, 0) })}
        </p>
      )}
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
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="group relative mt-1">
        <input
          type="text"
          inputMode="decimal"
          step={step}
          value={dirty ? draft : formatInputDecimal(value)}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => setDirty(false)}
          data-private={Number.isFinite(value) ? "" : undefined}
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
