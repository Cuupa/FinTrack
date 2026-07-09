// Per-instrument quote_scale: a provider-unit-to-native-unit multiplier (e.g.
// Yahoo returns gold per troy ounce, the catalog's XAU instrument is held per
// gram, quote_scale = 1 / 31.1034768). Shared by /api/quotes and /api/history
// so both apply it identically, AFTER any FX conversion, and only to resolved
// market prices — never to the synthetic fallback series or stored
// transaction prices. No imports here on purpose: this stays a pure module so
// it (and the routes that use it) can be unit tested without pulling in
// "server-only"-guarded modules like lib/server/supabase-keys.ts.

export interface ScalablePoint {
  date: string;
  close: number;
}

/**
 * Fold a per-instrument scale into a single resolved price. Strict no-op when
 * scale is undefined or 1 (the default, and every non-COMMODITY instrument).
 */
export function applyScale(price: number, scale?: number): number {
  const s = scale ?? 1;
  return s === 1 ? price : price * s;
}

/**
 * Multiply a history series by a combined (FX * per-instrument scale) factor.
 * Strict no-op when factor is 1 — avoids allocating a new array in the common
 * case, and returns the same point objects otherwise untouched.
 */
export function scalePoints<T extends ScalablePoint>(points: T[], factor: number): T[] {
  return factor === 1 ? points : points.map((p) => ({ ...p, close: p.close * factor }));
}
