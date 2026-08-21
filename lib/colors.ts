// Shared categorical palette used by the pie/line charts, plus a stable
// name→color mapping so a label (e.g. a custom tag) gets the same colour
// everywhere — its slice and its legend swatch.
//
// Categorical hues only (Audit §5.2): red and green are reserved for
// negative/positive, so a category must never borrow them, or a neutral slice
// reads as a loss or a gain. The first six mirror the --chart-1..6 tokens
// (app/globals.css); the rest extend them with further blue/purple/amber/slate
// hues, still avoiding red and green.

export const PALETTE = [
  "#5364d8",
  "#1689a5",
  "#7b50c7",
  "#a96b0b",
  "#a64a82",
  "#647286",
  "#3b82f6",
  "#8b5cf6",
  "#0891b2",
  "#ea580c",
  "#a855f7",
  "#b45309",
];

/** Deterministic colour for a label (same input → same colour). */
export function colorForLabel(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
