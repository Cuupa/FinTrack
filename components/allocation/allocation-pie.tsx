"use client";

// Interactive donut allocation chart. Hovering a segment (or a legend row)
// highlights it, dims the rest, and shows that slice's value in the centre.

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
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
  const [active, setActive] = useState<number | null>(null);

  if (total <= 0) {
    return <p className="py-16 text-center text-sm text-zinc-500">No data</p>;
  }

  const sel = active != null ? slices[active] : null;

  return (
    <div className="flex flex-col items-center justify-center gap-10 sm:flex-row sm:items-center sm:gap-14">
      {/* Donut with a centre readout */}
      <div
        className="relative h-72 w-72 shrink-0"
        onMouseLeave={() => setActive(null)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={94}
              outerRadius={active === null ? 130 : 134}
              paddingAngle={slices.length > 1 ? 2 : 0}
              cornerRadius={6}
              stroke="none"
              onMouseEnter={(_, i: number) => setActive(i)}
              isAnimationActive={false}
            >
              {slices.map((_, i) => (
                <Cell
                  key={i}
                  fill={PALETTE[i % PALETTE.length]}
                  opacity={active === null || active === i ? 1 : 0.25}
                  style={{ transition: "opacity 150ms" }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {sel ? (
            <>
              <span className="max-w-[8rem] truncate text-xs text-zinc-500">
                {sel.label}
              </span>
              <span className="mt-0.5 text-xl font-semibold tabular-nums">
                {formatNumber((sel.value / total) * 100, 1)}%
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {formatCurrency(sel.value, currency)}
              </span>
            </>
          ) : (
            <>
              <span className="text-xs uppercase tracking-wide text-zinc-400">
                Total
              </span>
              <span className="mt-0.5 text-xl font-semibold tabular-nums">
                {formatCurrency(total, currency)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Interactive legend — no forced scroll; flows into two columns when
          there are many slices so the donut stays prominent and everything is
          visible. Exact € is shown in the donut centre on hover (not repeated). */}
      <ul
        className={`grid w-full gap-x-8 gap-y-0.5 text-sm ${
          slices.length > 8 ? "sm:max-w-2xl sm:grid-cols-2" : "max-w-md"
        }`}
      >
        {slices.map((s, i) => {
          const isActive = active === i;
          const dim = active !== null && !isActive;
          return (
            <li
              key={s.label}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className={`flex cursor-default items-center gap-3 rounded-lg px-3 py-1.5 transition-colors ${
                isActive ? "bg-zinc-100 dark:bg-zinc-800" : ""
              } ${dim ? "opacity-50" : ""}`}
            >
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-[4px] transition-transform"
                style={{
                  backgroundColor: PALETTE[i % PALETTE.length],
                  transform: isActive ? "scale(1.25)" : "scale(1)",
                }}
              />
              <span
                className={`min-w-0 flex-1 truncate ${
                  isActive
                    ? "font-medium text-zinc-900 dark:text-white"
                    : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                {s.label}
              </span>
              <span className="w-14 shrink-0 text-right font-semibold tabular-nums">
                {formatNumber((s.value / total) * 100, 1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
