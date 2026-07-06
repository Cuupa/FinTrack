// Shared Y-axis helpers for every Recharts line/bar/fan chart: a snug width
// estimate (no DOM measurement — pure computation from data already on hand)
// so charts stop reserving a fixed wide gutter on the left, and a currency
// tick formatter that keeps small-value axes fully precise but compacts large
// ones ("€12.5k") so a 7-figure portfolio doesn't force the axis wide again.

import { decimalPlaces, formatCompactCurrency, formatCurrency } from "@/lib/format";

// Calibrated against actual rendered tick-label bounding boxes at fontSize 12
// (Geist): width ≈ 6px/char plus a fixed cost for the currency symbol/sign,
// and Recharts reserves ~8px between the label's right edge and the axis
// line — undershooting either clips the label (verified with Playwright
// against "€50K", "€100K", etc. at narrow widths).
const CHAR_WIDTH_PX = 7;
const PADDING_PX = 16;
const MIN_WIDTH = 28;
const MAX_WIDTH = 72;

/**
 * Estimate a snug Recharts `<YAxis width>` from the formatted tick labels
 * that will actually be rendered. Clamped to [MIN_WIDTH, MAX_WIDTH] so short
 * axes (percent, small currency) shrink and long ones (7-figure values) never
 * get clipped.
 */
export function yAxisWidth(labels: readonly string[]): number {
  const longest = labels.reduce((m, s) => Math.max(m, s.length), 0);
  const estimated = Math.ceil(longest * CHAR_WIDTH_PX + PADDING_PX);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, estimated));
}

/**
 * Currency tick formatter shared by every chart with a currency y-axis: below
 * 10k, ticks stay full-precision and aligned to the tick that needs the most
 * decimals (a whole 5 reads "5.00" beside "4.50"); at/above 10k they compact
 * ("€12.5k") instead of demanding ever more axis width.
 */
export function axisCurrencyFormatter(ticks: readonly number[], currency: string): (v: number) => string {
  const maxAbs = ticks.length ? Math.max(...ticks.map((v) => Math.abs(v))) : 0;
  if (ticks.length > 0 && maxAbs < 10_000) {
    const digits = Math.max(0, ...ticks.map((v) => decimalPlaces(v)));
    return (v: number) => formatCurrency(v, currency, digits);
  }
  return (v: number) => formatCompactCurrency(v, currency);
}
