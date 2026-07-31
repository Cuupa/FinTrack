"use client";

// One risk metric as a card: the figure, a quality reading, and a track that
// places it between the thresholds that matter for THAT metric. Extracted from
// the risk tab so the per-asset risk section renders the identical element
// rather than a second look-alike (owner rule: one element, used everywhere).

import { InfoTip } from "@/components/ui/info-tip";
import { useI18n } from "@/lib/i18n/i18n-context";

const RED = "#ef4444";
const AMBER = "#f59e0b";
const GREEN = "#10b981";

/**
 * Quality tier (0 poor · 1 moderate · 2 good) from the value vs the metric's
 * REAL thresholds — not its position in [min,max]. This is why a Sharpe of 1.12
 * reads green ("good") even though it sits mid-range on a −1…3 axis.
 */
function tier(value: number, good: number, ok: number, higherIsBetter: boolean): 0 | 1 | 2 {
  if (higherIsBetter) return value >= good ? 2 : value >= ok ? 1 : 0;
  return value <= good ? 2 : value <= ok ? 1 : 0;
}

const TIER_COLOR = [RED, AMBER, GREEN];

// Neutral (no inherent "good"/"bad" direction) marker/text color — zinc-500.
const NEUTRAL_COLOR = "#71717a";

export function MetricCard({
  label,
  info,
  value,
  min,
  max,
  good,
  ok,
  higherIsBetter,
  format,
  sub,
  neutral = false,
  reference,
}: {
  label: string;
  info: string;
  value: number | null;
  min: number;
  max: number;
  /** Value at/beyond which the metric is "good" (green). Unused when `neutral`. */
  good?: number;
  /** Value at/beyond which it is "moderate" (amber); worse than this is poor. Unused when `neutral`. */
  ok?: number;
  higherIsBetter?: boolean;
  format: (v: number) => string;
  sub?: string;
  /** No inherent "good"/"bad" direction (e.g. beta): suppresses the quality
   *  chip and the good/ok ticks, shows a single `reference` tick instead, and
   *  colors the marker/value a neutral zinc rather than red/amber/green. */
  neutral?: boolean;
  /** Tick position shown instead of good/ok when `neutral`. */
  reference?: number;
}) {
  const { t } = useI18n();
  const has = value != null && Number.isFinite(value);
  const clampFrac = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const frac = has ? clampFrac(value as number) : 0;
  const goodFrac = !neutral && good != null ? clampFrac(good) : null;
  const okFrac = !neutral && ok != null ? clampFrac(ok) : null;
  const refFrac = neutral && reference != null ? clampFrac(reference) : null;
  const q = !neutral && has && good != null && ok != null ? tier(value as number, good, ok, !!higherIsBetter) : 0;
  const color = neutral ? NEUTRAL_COLOR : has ? TIER_COLOR[q] : "#a1a1aa";
  const word =
    neutral || !has ? "" : q === 2 ? t("risk.qGood") : q === 1 ? t("risk.qModerate") : t("risk.qPoor");

  return (
    <div
      title={`${label}: ${info}`}
      className="group rounded-lg border border-zinc-200/70 bg-white p-3.5 transition-shadow hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      <div className="flex items-center gap-1 text-xs font-medium text-zinc-500">
        <span className="truncate">{label}</span>
        <InfoTip text={info} />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-1.5">
        <span className="text-2xl font-semibold tabular-nums" style={{ color }}>
          {has ? format(value as number) : "—"}
        </span>
        {word && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color, backgroundColor: `${color}1f` }}
          >
            {word}
          </span>
        )}
      </div>
      {/* neutral track + threshold ticks + colored marker at the value */}
      <div className="relative mt-3 h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
        {okFrac != null && (
          <span
            className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-zinc-400/70 dark:bg-zinc-600"
            style={{ left: `${okFrac * 100}%` }}
          />
        )}
        {goodFrac != null && (
          <span
            className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-zinc-400/70 dark:bg-zinc-600"
            style={{ left: `${goodFrac * 100}%` }}
          />
        )}
        {refFrac != null && (
          <span
            className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-zinc-400/70 dark:bg-zinc-600"
            style={{ left: `${refFrac * 100}%` }}
          />
        )}
        {has && (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-zinc-900"
            style={{ left: `${frac * 100}%`, backgroundColor: color }}
          />
        )}
      </div>
      {sub && <div className="mt-1.5 text-[10px] text-zinc-400 tabular-nums">{sub}</div>}
    </div>
  );
}
