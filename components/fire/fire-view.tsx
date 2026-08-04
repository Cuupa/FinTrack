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
import { formatCurrency, formatInputDecimal, formatPercentPlain, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Card, Stat, Toggle } from "@/components/ui/primitives";
import { Private } from "@/components/ui/private";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

// Default withdrawal rate: the classic "4% rule".
const DEFAULT_WITHDRAWAL_RATE = 4;

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

  const [withdrawalRatePercent, setWithdrawalRatePercent] = useState(DEFAULT_WITHDRAWAL_RATE);
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
  // What the chosen rate costs in risk. Raising the rate lowers every target,
  // which reads as nonsense until the failure rate it buys sits next to it.
  const risk = useMemo(
    () => ({
      lean: shortfallRisk({
        target: plan.lean,
        expectedReturn: effectiveReturnPercent / 100,
        volatility: fire.volatility,
        withdrawalRate: withdrawalRatePercent / 100,
      }),
      regular: shortfallRisk({
        target: plan.regular,
        expectedReturn: effectiveReturnPercent / 100,
        volatility: fire.volatility,
        withdrawalRate: withdrawalRatePercent / 100,
      }),
      fat: shortfallRisk({
        target: plan.fat,
        expectedReturn: effectiveReturnPercent / 100,
        volatility: fire.volatility,
        withdrawalRate: withdrawalRatePercent / 100,
      }),
    }),
    [plan.lean, plan.regular, plan.fat, effectiveReturnPercent, fire.volatility, withdrawalRatePercent],
  );

  const pensionNote =
    appliedPension && fire.retirementYear != null
      ? t("fire.tile.pensionApplied", { year: String(fire.retirementYear) })
      : undefined;

  const simulationParams = new URLSearchParams({
    years: String(Math.max(1, Math.min(80, Math.ceil(plan.yearsToRegular ?? 30)))),
    withdrawal: "30",
  });
  if (appliedPension) {
    simulationParams.set("pensionAnnual", String(appliedPension.annualIncome));
    simulationParams.set("pensionStart", String(appliedPension.yearsUntilStart));
  }

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
        <h2 className="text-lg font-semibold">{t("fire.simulation.title")}</h2>
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
      {/* The price of the rate, on the same card as the target it shrank. */}
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
          {t("fire.tile.risk", {
            risk: formatPercentPlain(risk, 0),
            years: RETIREMENT_YEARS,
          })}
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
