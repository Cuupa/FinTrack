"use client";

// Choosing how to draw the money down, and seeing what the choice costs.
//
// Shared by /simulation and the FIRE planner, because the question is the same
// on both and a second copy would drift the way the two Monte Carlo runners
// did. The panel is three things in one column:
//
//   pickers    -- the strategy, and the stress scenario to test it against
//   steps      -- what you actually DO under that strategy, in order
//   comparison -- every strategy over the same simulated markets
//
// The steps are the point of the whole feature. A strategy nobody can execute
// is a chart, not a plan: "guardrails" means nothing until it reads "check
// once a year, and only act when the number leaves the band".
//
// The comparison deliberately does not crown a winner. The strategies trade
// the same risk against each other -- a higher success rate is bought with an
// income that moves, and a steady income is bought with depletion risk -- so
// the table shows both sides and lets the user decide which one they can live
// with.

import {
  STRESS_SCENARIOS,
  WITHDRAWAL_STRATEGIES,
  type StrategyOutcome,
  type StressScenario,
  type WithdrawalStrategyId,
} from "@/lib/finance/withdrawal";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { SelectMenu } from "@/components/ui/select-menu";
import { Card } from "@/components/ui/primitives";
import { formatCurrency, formatPercentPlain } from "@/lib/format";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";

/** Each strategy explains itself in the same three beats: when to look, what
    to compare, what to change. */
const STEP_NUMBERS = [1, 2, 3] as const;

function useStrategyLabel() {
  const { t } = useI18n();
  return (id: WithdrawalStrategyId) => t(`withdrawal.strategy.${id}` as MessageKey);
}

/** The pickers and the steps: what the run is configured to do. Belongs with
    the other parameters. */
export function WithdrawalStrategyPanel({
  strategy,
  onStrategy,
  stress,
  onStress,
}: {
  strategy: WithdrawalStrategyId;
  onStrategy: (value: WithdrawalStrategyId) => void;
  stress: StressScenario;
  onStress: (value: StressScenario) => void;
}) {
  const { t } = useI18n();
  const strategyLabel = useStrategyLabel();

  return (
    <div className="space-y-4" data-tour="withdrawal-strategy">
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t("withdrawal.strategyLabel")}</label>
          <SelectMenu
            className="mt-1"
            ariaLabel={t("withdrawal.strategyLabel")}
            value={strategy}
            onChange={(value) => onStrategy(value as WithdrawalStrategyId)}
            options={WITHDRAWAL_STRATEGIES.map((id) => ({ value: id, label: strategyLabel(id) }))}
          />
          <p className="mt-1 text-xs text-zinc-500">
            {t(`withdrawal.strategy.${strategy}.desc` as MessageKey)}
          </p>
        </div>

        <div>
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
      </div>

      <div>
        <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          {t("withdrawal.stepsTitle")}
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          {STEP_NUMBERS.map((n) => (
            <li key={n}>{t(`withdrawal.steps.${strategy}.${n}` as MessageKey)}</li>
          ))}
        </ol>
      </div>

    </div>
  );
}

/**
 * Every strategy over the same simulated markets. A RESULT, so it belongs in
 * the results column beside the chart, not squeezed into the parameter form
 * where four currency columns have nowhere to go.
 */
export function WithdrawalComparison({
  comparison,
  strategy,
  currency,
}: {
  comparison: StrategyOutcome[];
  /** The selected strategy, highlighted in the table. */
  strategy: WithdrawalStrategyId;
  currency: string;
}) {
  const { t } = useI18n();
  const strategyLabel = useStrategyLabel();
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
              <Td className="font-medium">{strategyLabel(row.strategy)}</Td>
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
