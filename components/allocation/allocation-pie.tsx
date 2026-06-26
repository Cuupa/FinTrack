"use client";

// A single labelled allocation pie chart.

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Slice } from "@/lib/finance/allocation";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/primitives";

const PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#06b6d4",
  "#a855f7",
];

export function AllocationPie({
  title,
  slices,
  currency,
}: {
  title: string;
  slices: Slice[];
  currency: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <Card>
      <h3 className="text-sm font-semibold">{title}</h3>
      {total <= 0 ? (
        <p className="mt-6 text-center text-sm text-zinc-500">No data</p>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <div className="h-40 w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={38}
                  outerRadius={72}
                  paddingAngle={1}
                  isAnimationActive={false}
                >
                  {slices.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid rgba(120,120,120,0.3)",
                    fontSize: 13,
                  }}
                  formatter={(value) => {
                    const v = Number(value);
                    return [
                      `${formatCurrency(v, currency)} (${formatNumber((v / total) * 100, 1)}%)`,
                      "",
                    ];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-1 text-sm">
            {slices.slice(0, 6).map((s, i) => (
              <li key={s.label} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                  {s.label}
                </span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  {formatNumber((s.value / total) * 100, 1)}%
                </span>
              </li>
            ))}
            {slices.length > 6 && (
              <li className="text-xs text-zinc-400">+{slices.length - 6} more</li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}
