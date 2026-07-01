// Y-axis tick generation for the line charts. Every returned tick is a multiple
// of a "nice" step drawn from a set whose members keep the last visible digit at
// 0 or 5 (e.g. 0.05, 0.1, 0.25, 0.5, 5, 10, 25, 50, 100, 250 …), so axis labels
// read cleanly instead of landing on arbitrary values like 132 or 156.

const SUB_ONE = [0.05, 0.1, 0.25, 0.5];
const BIG_BASES = [5, 10, 25, 50];

function niceSteps(): number[] {
  const steps = [...SUB_ONE];
  for (let k = 0; k < 12; k++) {
    const p = Math.pow(10, k);
    for (const b of BIG_BASES) steps.push(b * p);
  }
  return steps.sort((a, b) => a - b);
}

const STEPS = niceSteps();

function pickStep(raw: number): number {
  if (!(raw > 0)) return STEPS[0];
  for (const s of STEPS) if (s >= raw * 0.999) return s;
  return STEPS[STEPS.length - 1];
}

export function niceTicks(min: number, max: number, maxTicks = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi === lo) {
    hi = lo + Math.abs(lo || 1);
  }
  const step = pickStep((hi - lo) / Math.max(1, maxTicks));
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const count = Math.round((end - start) / step);
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    const cents = Math.round((start + i * step) * 100);
    ticks.push(cents / 100);
  }
  return ticks;
}
