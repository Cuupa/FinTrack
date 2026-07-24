"use client";

// Cash-flow Sankey (ROADMAP #2 follow-up): income category groups -> Total ->
// expense category groups, plus a Savings/"from savings" link carrying the
// period's net (see spendingSankeyData in lib/finance/spending.ts, which owns
// all the graph-building logic — this file only wires context + rendering).
// Category node/link colors reuse the shared categorical palette
// (lib/colors.ts) so a category keeps the same color here as in
// AllocationPie; Total/Savings/Shortfall get fixed neutral/semantic colors
// instead of cycling into the categorical palette (mirrors the BUY/SELL
// marker convention in performance-chart.tsx).

import { useMemo, useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import type { SankeyLinkProps, SankeyNodeProps } from "recharts";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { type Timeframe, timeframeStart, today } from "@/lib/finance/dates";
import { incomeExpenseSplit, spendingSankeyData, toBaseCurrency, type SankeyGraph } from "@/lib/finance/spending";
import { colorForLabel } from "@/lib/colors";
import { formatCurrency } from "@/lib/format";
import { Card, SegmentedControl } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

const PERIODS: Timeframe[] = ["1M", "3M", "YTD", "1Y", "MAX"];

const HUB_COLOR = "#71717a";
const SAVINGS_COLOR = "#10b981";
const SHORTFALL_COLOR = "#ef4444";

type SankeyNode = SankeyGraph["nodes"][number];

function colorForNode(node: SankeyNode, labels: { total: string; savings: string; shortfall: string }): string {
  if (node.name === labels.total) return HUB_COLOR;
  if (node.name === labels.savings) return SAVINGS_COLOR;
  if (node.name === labels.shortfall) return SHORTFALL_COLOR;
  return colorForLabel(node.name);
}

export function SpendingSankeyCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const [timeframe, setTimeframe] = useState<Timeframe>("3M");

  const earliest = useMemo(
    () =>
      data.spendingTransactions.reduce<string | null>(
        (min, tx) => (min === null || tx.date < min ? tx.date : min),
        null,
      ),
    [data.spendingTransactions],
  );

  const windowed = useMemo(() => {
    const start = timeframeStart(timeframe, today(), earliest);
    return data.spendingTransactions.filter((tx) => tx.date >= start);
  }, [data.spendingTransactions, timeframe, earliest]);

  const converted = useMemo(
    () => toBaseCurrency(windowed, data.accounts, base, valuation.fx),
    [windowed, data.accounts, base, valuation.fx],
  );

  const labels = useMemo(
    () => ({
      total: t("spending.sankey.totalNode"),
      savings: t("spending.sankey.savingsNode"),
      shortfall: t("spending.sankey.shortfallNode"),
      uncategorizedIncome: t("spending.list.uncategorized"),
      uncategorizedExpense: t("spending.list.uncategorized"),
    }),
    [t],
  );

  const graph = useMemo(
    () => spendingSankeyData(converted, data.spendingCategories, labels),
    [converted, data.spendingCategories, labels],
  );

  const split = useMemo(() => incomeExpenseSplit(converted), [converted]);

  const ariaLabel = t("spending.sankey.ariaLabel", {
    income: formatCurrency(split.income, base),
    expense: formatCurrency(split.expense, base),
    net: formatCurrency(split.net, base),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("spending.sankey.title")}</h2>
        <SegmentedControl
          size="sm"
          value={timeframe}
          onChange={setTimeframe}
          options={PERIODS.map((tf) => ({ label: tf, value: tf }))}
        />
      </div>
      {graph.nodes.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">{t("common.noData")}</p>
      ) : (
        <div role="img" aria-label={ariaLabel} className="mt-4">
          <ResponsiveContainer width="100%" height={380}>
            <Sankey
              data={graph}
              nodeWidth={12}
              nodePadding={28}
              iterations={64}
              margin={{ top: 16, right: 100, bottom: 16, left: 100 }}
              node={(props: SankeyNodeProps) => {
                const node = props.payload as unknown as SankeyNode;
                const fill = colorForNode(node, labels);
                const isSource = node.column === "source";
                const isTarget = node.column === "target";
                const labelX = isTarget ? props.x - 6 : isSource ? props.x + props.width + 6 : props.x + props.width / 2;
                const labelY = node.column === "hub" ? props.y - 8 : props.y + props.height / 2;
                return (
                  <g>
                    <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={fill} rx={2} />
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor={isTarget ? "end" : isSource ? "start" : "middle"}
                      dominantBaseline={node.column === "hub" ? "auto" : "middle"}
                      className="fill-zinc-700 text-xs dark:fill-zinc-200"
                    >
                      {node.name}
                    </text>
                  </g>
                );
              }}
              link={(props: SankeyLinkProps) => {
                const source = props.payload.source as unknown as SankeyNode;
                const target = props.payload.target as unknown as SankeyNode;
                const node = source.column !== "hub" ? source : target;
                const stroke = colorForNode(node, labels);
                return (
                  <path
                    d={`M${props.sourceX},${props.sourceY} C${props.sourceControlX},${props.sourceY} ${props.targetControlX},${props.targetY} ${props.targetX},${props.targetY}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={props.linkWidth}
                    strokeOpacity={0.35}
                  />
                );
              }}
            >
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const entry = payload[0];
                  return (
                    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                      <div className="font-medium">{entry.name}</div>
                      <div className="tabular-nums text-zinc-500" data-private>
                        {formatCurrency(Number(entry.value) || 0, base)}
                      </div>
                    </div>
                  );
                }}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
