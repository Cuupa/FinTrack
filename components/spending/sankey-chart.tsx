"use client";

// The cash-flow Sankey chart, rendering only. Shared by the live SpendingSankeyCard
// and the read-only SharedSankeyView so a shared diagram looks identical to the
// owner's. Category node/link colors reuse the shared categorical palette
// (lib/colors.ts); Total/Savings/Shortfall get fixed neutral/semantic colors.
// `formatValue` renders the tooltip figure (currency for a full share, a percent
// of throughput for an incognito one).

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import type { SankeyLinkProps, SankeyNodeProps } from "recharts";
import { colorForLabel } from "@/lib/colors";
import type { SankeyGraph } from "@/lib/finance/spending";

const HUB_COLOR = "#71717a";
const SAVINGS_COLOR = "#10b981";
const SHORTFALL_COLOR = "#ef4444";

type SankeyNode = SankeyGraph["nodes"][number];

export interface SankeyChartLabels {
  total: string;
  savings: string;
  shortfall: string;
}

function colorForNode(node: SankeyNode, labels: SankeyChartLabels): string {
  if (node.name === labels.total) return HUB_COLOR;
  if (node.name === labels.savings) return SAVINGS_COLOR;
  if (node.name === labels.shortfall) return SHORTFALL_COLOR;
  return colorForLabel(node.name);
}

export function SankeyChart({
  graph,
  labels,
  formatValue,
  ariaLabel,
}: {
  graph: SankeyGraph;
  labels: SankeyChartLabels;
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  return (
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
                <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="font-medium">{entry.name}</div>
                  <div className="tabular-nums text-zinc-500" data-private>
                    {formatValue(Number(entry.value) || 0)}
                  </div>
                </div>
              );
            }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
