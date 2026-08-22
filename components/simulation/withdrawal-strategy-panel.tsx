"use client";

// Choosing how to draw the money down, and seeing what the choice costs.
//
// Shared by /simulation and the FIRE planner: both configure the SAME
// `WithdrawalPlan` (lib/finance/withdrawal-plan.ts), they just consume its
// result differently -- FIRE sizes a target from it, the simulation runs
// paths through it. A second, independent copy of this panel is exactly
// what let the two pages drift (see WITHDRAWAL_REFACTOR_PLAN.md §3).
//
// The panel is three things in one column:
//
//   picker + fields -- the strategy, and ONLY the fields that strategy uses
//   steps           -- what you actually DO under that strategy, in order
//   comparison      -- every strategy over the same simulated markets
//                       (simulation only, rendered separately -- see
//                       `WithdrawalComparison` below)
//
// Field visibility follows the strategy, never the other way round: a
// `fixedRealAmount` plan shows an amount field and no rate, a
// `currentPortfolioShare` plan shows a rate and no inflation control (that
// strategy already re-tracks the market every year, which IS its inflation
// adjustment -- showing a second one would suggest it compounds on top).

import {
  DEFAULT_GUARDRAIL_ADJUST,
  DEFAULT_GUARDRAIL_BAND,
  STRESS_SCENARIOS,
  type StrategyOutcome,
  type StressScenario,
} from "@/lib/finance/withdrawal";
import {
  WITHDRAWAL_STRATEGY_KINDS,
  type WithdrawalPlan,
  type WithdrawalStrategyKind,
} from "@/lib/finance/withdrawal-plan";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { SelectMenu } from "@/components/ui/select-menu";
import { Card, Toggle } from "@/components/ui/primitives";
import { SliderField } from "@/components/ui/slider-field";
import { formatCurrency, formatPercentPlain } from "@/lib/format";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";

const STEP_NUMBERS = [1, 2, 3] as const;
const DEFAULT_FIXED_AMOUNT_ANNUAL = 24000;
const DEFAULT_RATE_PERCENT = 4;

function useStrategyLabel() {
  const { t } = useI18n();
  return (id: WithdrawalStrategyKind) => t(`withdrawal.strategy.${id}` as MessageKey);
}

/**
 * The stress scenario, on its own -- a property of the MARKET, not of how
 * the money is drawn, so it applies to every run (with or without a
 * drawdown phase) rather than sitting inside the strategy fields.
 */
export function StressPicker({
  stress,
  onStress,
}: {
  stress: StressScenario;
  onStress: (value: StressScenario) => void;
}) {
  const { t } = useI18n();
  return (
    <div data-tour="stress-scenario">
      <label className="text-sm font-medium">{t("withdrawal.stressLabel")}</label>
      <SelectMenu
        className="mt-1"
        ariaLabel={t("withdrawal.stressLabel")}
        value={stress}
        onChange={(value) => onStress(value as StressScenario)}
        options={STRESS_SCENARIOS.map((id) => ({
          value: id,
          label: t(`withdrawal.stress.${id}` as MessageKey),
        }))}
      />
      <p className="mt-1 text-xs text-zinc-500">
        {t(`withdrawal.stress.${stress}.desc` as MessageKey)}
      </p>
    </div>
  );
}

/** Switches the plan's strategy, converting the numeric value where it
    carries over cleanly and resetting what does not -- so a field left over
    from the previous strategy never silently stays in effect. */
function withStrategy(plan: WithdrawalPlan, strategy: WithdrawalStrategyKind): WithdrawalPlan {
  if (strategy === "fixedRealAmount") {
    return {
      ...plan,
      strategy,
      amount:
        plan.amount.kind === "amount" ? plan.amount : { kind: "amount", value: DEFAULT_FIXED_AMOUNT_ANNUAL },
      guardrails: undefined,
    };
  }
  return {
    ...plan,
    strategy,
    amount:
      plan.amount.kind === "rate" ? plan.amount : { kind: "rate", value: DEFAULT_RATE_PERCENT / 100 },
    guardrails:
      strategy === "guardrails"
        ? (plan.guardrails ?? { band: DEFAULT_GUARDRAIL_BAND, adjust: DEFAULT_GUARDRAIL_ADJUST })
        : undefined,
  };
}

/**
 * The strategy picker, ONLY the fields that strategy uses, and the 3-step
 * "what you do" explanation. Belongs with the other withdrawal parameters on
 * both FIRE and the simulation.
 */
export function WithdrawalStrategyPanel({
  plan,
  onPlanChange,
  currency,
}: {
  plan: WithdrawalPlan;
  onPlanChange: (plan: WithdrawalPlan) => void;
  /** For the amount field's currency suffix and the worked example. */
  currency: string;
}) {
  const { t } = useI18n();
  const strategyLabel = useStrategyLabel();

  const ratePercent = plan.amount.kind === "rate" ? plan.amount.value * 100 : DEFAULT_RATE_PERCENT;
  const amountValue = plan.amount.kind === "amount" ? plan.amount.value : DEFAULT_FIXED_AMOUNT_ANNUAL;
  const inflationPercent = plan.inflation.assumedRate * 100;

  function setAmount(value: number) {
    onPlanChange({ ...plan, amount: { kind: "amount", value } });
  }
  function setRate(percent: number) {
    onPlanChange({ ...plan, amount: { kind: "rate", value: Math.max(0, percent) / 100 } });
  }
  function setInflationIndexed(indexed: boolean) {
    onPlanChange({ ...plan, inflation: { ...plan.inflation, indexed } });
  }
  function setInflationRate(percent: number) {
    onPlanChange({
      ...plan,
      inflation: { indexed: true, assumedRate: Math.max(0, percent) / 100 },
    });
  }
  function setGuardrails(patch: Partial<{ band: number; adjust: number }>) {
    onPlanChange({
      ...plan,
      guardrails: {
        band: plan.guardrails?.band ?? DEFAULT_GUARDRAIL_BAND,
        adjust: plan.guardrails?.adjust ?? DEFAULT_GUARDRAIL_ADJUST,
        ...patch,
      },
    });
  }

  // The worked example from the strategy's own description -- a concrete
  // number beats an abstract explanation (WITHDRAWAL_REFACTOR_PLAN.md §9.3).
  const examplePortfolio = 400000;
  const exampleAmount =
    plan.strategy === "fixedRealAmount"
      ? amountValue
      : examplePortfolio * (ratePercent / 100);

  return (
    <div className="space-y-4" data-tour="withdrawal-strategy">
      <div>
        <label className="text-sm font-medium">{t("withdrawal.strategyLabel")}</label>
        <SelectMenu
          className="mt-1"
          ariaLabel={t("withdrawal.strategyLabel")}
          value={plan.strategy}
          onChange={(value) => onPlanChange(withStrategy(plan, value as WithdrawalStrategyKind))}
          options={WITHDRAWAL_STRATEGY_KINDS.map((id) => ({ value: id, label: strategyLabel(id) }))}
        />
        <p className="mt-1 text-xs text-zinc-500">
          {t(`withdrawal.strategy.${plan.strategy}.desc` as MessageKey)}
        </p>
      </div>

      {/* Only the fields THIS strategy uses -- never a control the chosen
          strategy ignores (WITHDRAWAL_REFACTOR_PLAN.md §9.1). */}
      <div className="space-y-3 rounded-lg border border-zinc-200 p-3.5 dark:border-zinc-800">
        {plan.strategy === "fixedRealAmount" ? (
          <>
            <SliderField
              label={t("withdrawal.field.annualAmount")}
              suffix={currency}
              value={amountValue}
              onChange={setAmount}
              min={0}
              max={Math.max(100000, Math.round(amountValue * 2))}
              step={500}
              isPrivate
            />
            <Toggle
              checked={plan.inflation.indexed}
              onChange={setInflationIndexed}
              label={t("withdrawal.field.inflationIndexed")}
              hint={t("withdrawal.field.inflationIndexed.hint")}
            />
          </>
        ) : (
          <>
            <SliderField
              label={t(
                plan.strategy === "initialRate"
                  ? "withdrawal.field.rateAtRetirement"
                  : plan.strategy === "currentPortfolioShare"
                    ? "withdrawal.field.rateCurrentValue"
                    : "withdrawal.field.rateGuardrails",
              )}
              suffix="%"
              value={ratePercent}
              onChange={setRate}
              min={0}
              max={10}
              step={0.1}
              digits={1}
            />
            {plan.strategy === "guardrails" && (
              <>
                <SliderField
                  label={t("withdrawal.field.guardrailBand")}
                  suffix="%"
                  value={(plan.guardrails?.band ?? DEFAULT_GUARDRAIL_BAND) * 100}
                  onChange={(v) => setGuardrails({ band: Math.max(0, v) / 100 })}
                  min={5}
                  max={50}
                  step={1}
                />
                <SliderField
                  label={t("withdrawal.field.guardrailAdjust")}
                  suffix="%"
                  value={(plan.guardrails?.adjust ?? DEFAULT_GUARDRAIL_ADJUST) * 100}
                  onChange={(v) => setGuardrails({ adjust: Math.max(0, v) / 100 })}
                  min={1}
                  max={30}
                  step={1}
                />
              </>
            )}
          </>
        )}

        {/* currentPortfolioShare already re-tracks the market every year --
            that IS its inflation adjustment, so no second one is offered. */}
        {plan.strategy !== "currentPortfolioShare" && plan.strategy !== "fixedRealAmount" && (
          <SliderField
            label={t("withdrawal.field.inflation")}
            suffix="%"
            value={inflationPercent}
            onChange={setInflationRate}
            min={0}
            max={8}
            step={0.1}
            digits={1}
          />
        )}
        {plan.strategy === "fixedRealAmount" && plan.inflation.indexed && (
          <SliderField
            label={t("withdrawal.field.inflation")}
            suffix="%"
            value={inflationPercent}
            onChange={setInflationRate}
            min={0}
            max={8}
            step={0.1}
            digits={1}
          />
        )}
      </div>

      {/* A worked example beats an abstract rule (§9.3). `formatCurrency`
          renders differently per locale (symbol position, grouping) even for
          the same round number, and this text can sit inside a Suspense
          boundary seeded from `useSearchParams()` (the /simulation panel)
          whose first paint resolves the locale independently of the page
          shell -- suppress the resulting one-frame hydration diff rather
          than the (harmless, self-correcting) content itself. */}
      <p className="text-xs text-zinc-500" data-private suppressHydrationWarning>
        {t(`withdrawal.strategy.${plan.strategy}.example` as MessageKey, {
          portfolio: formatCurrency(examplePortfolio, currency, 0),
          rate: formatPercentPlain(ratePercent / 100, 1),
          amount: formatCurrency(exampleAmount, currency, 0),
        })}
      </p>

      <div>
        <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          {t("withdrawal.stepsTitle")}
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          {STEP_NUMBERS.map((n) => (
            <li key={n}>{t(`withdrawal.steps.${plan.strategy}.${n}` as MessageKey)}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * Every strategy over the same simulated markets. A RESULT, so it belongs in
 * the results column beside the chart, not squeezed into the parameter form
 * where four currency columns have nowhere to go. Deliberately still keyed
 * by the engine's five `WithdrawalStrategyId`s (including `floorCeiling` and
 * `vpw`, which stay engine-available for comparison even though the plan
 * picker above no longer offers them as a starting strategy).
 */
export function WithdrawalComparison({
  comparison,
  strategy,
  currency,
}: {
  comparison: StrategyOutcome[];
  /** The selected engine strategy id, highlighted in the table. */
  strategy: StrategyOutcome["strategy"];
  currency: string;
}) {
  const { t } = useI18n();
  if (comparison.length === 0) return null;

  return (
    <Card data-tour="withdrawal-comparison">
      <h2 className="text-lg font-semibold">{t("withdrawal.compareTitle")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("withdrawal.compareHint")}</p>
      <Table className="mt-3" ariaLabel={t("withdrawal.compareTitle")}>
        {/* Thead renders its own <tr>; call sites pass <Th> directly. */}
        <Thead>
          <Th>{t("withdrawal.col.strategy")}</Th>
          <Th align="right">{t("withdrawal.col.success")}</Th>
          <Th align="right">{t("withdrawal.col.income")}</Th>
          <Th align="right">{t("withdrawal.col.worstYear")}</Th>
          <Th align="right">{t("withdrawal.col.leftOver")}</Th>
        </Thead>
        <Tbody>
          {comparison.map((row) => (
            <Tr key={row.strategy} selected={row.strategy === strategy}>
              <Td className="font-medium">
                {t(`withdrawal.strategy.${row.strategy}` as MessageKey)}
              </Td>
              <Td align="right" className="tabular-nums">
                {formatPercentPlain(row.successRate)}
              </Td>
              <Td align="right" className="tabular-nums" data-private>
                {formatCurrency(row.medianIncome, currency, 0)}
              </Td>
              <Td align="right" className="tabular-nums" data-private>
                {formatCurrency(row.medianWorstYearIncome, currency, 0)}
              </Td>
              <Td align="right" className="tabular-nums" data-private>
                {formatCurrency(row.medianEndValue, currency, 0)}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}
