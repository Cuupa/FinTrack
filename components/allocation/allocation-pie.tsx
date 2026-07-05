"use client";

// Interactive donut allocation chart. Hovering a segment (or a legend row)
// highlights it, dims the rest, and shows that slice's value in the centre.

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { Slice } from "@/lib/finance/allocation";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/i18n-context";

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

const OTHER_COLOR = "#a1a1aa";
const OTHER_LABELS = new Set(["other", "others", "andere", "sonstige"]);

/**
 * Merge every slice below 1% of the total into a single "Other" bucket (folding
 * into an existing "Other" slice when present), so tiny slivers don't clutter
 * the donut. Colours are regrouped in lockstep so they stay aligned.
 */
function groupSmallSlices(
  slices: Slice[],
  colors: string[] | undefined,
  otherLabel: string,
): { slices: Slice[]; colors: string[] } {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const colorFor = (i: number) => colors?.[i] ?? PALETTE[i % PALETTE.length];
  if (total <= 0) return { slices, colors: slices.map((_, i) => colorFor(i)) };

  const threshold = 0.01 * total;
  const kept: Slice[] = [];
  const keptColors: string[] = [];
  let otherSum = 0;
  let otherIdx = -1;

  slices.forEach((s, i) => {
    const isOther = OTHER_LABELS.has(s.label.trim().toLowerCase());
    if (s.value >= threshold || isOther) {
      if (isOther) otherIdx = kept.length;
      kept.push(s);
      keptColors.push(isOther ? OTHER_COLOR : colorFor(i));
    } else {
      otherSum += s.value;
    }
  });

  if (otherSum > 0) {
    if (otherIdx >= 0) {
      kept[otherIdx] = { ...kept[otherIdx], value: kept[otherIdx].value + otherSum };
    } else {
      kept.push({ label: otherLabel, value: otherSum });
      keptColors.push(OTHER_COLOR);
    }
  }
  return { slices: kept, colors: keptColors };
}

export function AllocationPie({
  slices,
  currency,
  colors,
  showTotal = true,
  title,
}: {
  slices: Slice[];
  currency: string;
  /** Optional per-slice colours (aligned to `slices`); defaults to the palette. */
  colors?: string[];
  /** Show the currency total/values in the centre. Off when slices are weights
   *  (e.g. an incognito shared view), where absolute amounts don't exist. */
  showTotal?: boolean;
  /** Short name of what's being broken down (e.g. "Investment", "Currency"),
   *  used only to build the chart's accessible label. */
  title?: string;
}) {
  const { t } = useI18n();
  const grouped = useMemo(
    () => groupSmallSlices(slices, colors, t("common.other")),
    [slices, colors, t],
  );
  const gSlices = grouped.slices;
  const total = gSlices.reduce((s, x) => s + x.value, 0);
  const [active, setActive] = useState<number | null>(null);
  const colorAt = (i: number) => grouped.colors[i] ?? PALETTE[i % PALETTE.length];

  if (total <= 0) {
    return <p className="py-16 text-center text-sm text-zinc-500">No data</p>;
  }

  const sel = active != null ? gSlices[active] : null;

  // The full breakdown is already rendered as an accessible <ul> legend right
  // next to the donut, so the chart's own label only needs to summarize
  // (total + largest share) and point at the list for detail.
  const top = [...gSlices].sort((a, b) => b.value - a.value)[0];
  const ariaLabel = t("chart.allocation.ariaLabel", {
    title: title ?? "",
    total: showTotal ? formatCurrency(total, currency) : "100%",
    label: top.label,
    pct: `${formatNumber((top.value / total) * 100, 1)}%`,
  });

  return (
    <div className="flex flex-col items-center justify-center gap-10 sm:flex-row sm:items-start sm:gap-14">
      {/* Donut with a centre readout */}
      <div
        role="img"
        aria-label={ariaLabel}
        className="relative h-72 w-72 shrink-0"
        onMouseLeave={() => setActive(null)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={gSlices}
              dataKey="value"
              nameKey="label"
              innerRadius={94}
              outerRadius={active === null ? 130 : 134}
              paddingAngle={gSlices.length > 1 ? 2 : 0}
              cornerRadius={6}
              stroke="none"
              onMouseEnter={(_, i: number) => setActive(i)}
              isAnimationActive={false}
            >
              {gSlices.map((_, i) => (
                <Cell
                  key={i}
                  fill={colorAt(i)}
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
              {showTotal && (
                <span className="text-xs text-zinc-500 tabular-nums" data-private>
                  {formatCurrency(sel.value, currency)}
                </span>
              )}
            </>
          ) : showTotal ? (
            <>
              <span className="text-xs uppercase tracking-wide text-zinc-400">
                {t("common.total")}
              </span>
              <span className="mt-0.5 text-xl font-semibold tabular-nums" data-private>
                {formatCurrency(total, currency)}
              </span>
            </>
          ) : (
            <span className="text-xs uppercase tracking-wide text-zinc-400">
              {t("common.total")} 100%
            </span>
          )}
        </div>
      </div>

      {/* Interactive legend — no forced scroll; flows into two columns when
          there are many slices so the donut stays prominent and everything is
          visible. Exact € is shown in the donut centre on hover (not repeated).
          `grid-cols-1` (not just an implicit column) is required here: an
          implicit grid track sizes to its items' *max-content* width, which
          ignores `truncate`/overflow-hidden — so a long name would force the
          row (and the card) wider than the viewport. `grid-cols-*` utilities
          emit `minmax(0, 1fr)`, which lets the column — and the name span's
          truncation inside it — actually shrink to the container. */}
      <ul
        className={`grid w-full grid-cols-1 gap-x-8 gap-y-0.5 text-sm ${
          gSlices.length > 8 ? "sm:max-w-2xl sm:grid-cols-2" : "max-w-md"
        }`}
      >
        {gSlices.map((s, i) => {
          const isActive = active === i;
          const dim = active !== null && !isActive;
          return (
            <li
              key={s.label}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              title={s.label}
              className={`flex min-w-0 cursor-default items-center gap-3 rounded-lg px-3 py-1.5 transition-colors ${
                isActive ? "bg-zinc-100 dark:bg-zinc-800" : ""
              } ${dim ? "opacity-50" : ""}`}
            >
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-[4px] transition-transform"
                style={{
                  backgroundColor: colorAt(i),
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
