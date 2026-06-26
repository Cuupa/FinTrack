"use client";

// Allocation pie chart content (pie + full legend). No card wrapper — the
// parent supplies the card and the category tabs.

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Slice } from "@/lib/finance/allocation";
import { formatCurrency, formatNumber } from "@/lib/format";

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
  slices,
  currency,
}: {
  slices: Slice[];
  currency: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0) {
    return <p className="py-16 text-center text-sm text-zinc-500">No data</p>;
  }

  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center">
      <div className="h-64 w-64 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={64}
              outerRadius={120}
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

      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
              {s.label}
            </span>
            <span className="shrink-0 tabular-nums text-zinc-500">
              {formatCurrency(s.value, currency)}
            </span>
            <span className="w-14 shrink-0 text-right font-medium tabular-nums">
              {formatNumber((s.value / total) * 100, 1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
