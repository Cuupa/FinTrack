// Shared categorical palette used by the pie/line charts, plus a stable
// name→color mapping so a label (e.g. a custom tag) gets the same colour
// everywhere — its badge and its pie slice.

export const PALETTE = [
  "#6366f1",
  "#059669",
  "#d97706",
  "#ef4444",
  "#0891b2",
  "#ec4899",
  "#65a30d",
  "#8b5cf6",
  "#0d9488",
  "#3b82f6",
  "#ea580c",
  "#a855f7",
];

/** Deterministic colour for a label (same input → same colour). */
export function colorForLabel(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
