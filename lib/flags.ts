// Feature flags — toggled per environment (e.g. Vercel env vars) so whole
// features can be enabled/disabled without a code change.
//
// Every flag reads a `NEXT_PUBLIC_FEATURE_*` variable. These MUST be referenced
// by their full literal name below: Next.js inlines `process.env.NEXT_PUBLIC_*`
// at build time by static substitution, so a dynamic lookup would NOT work.
// Set the variable to "0", "false", or "off" (any case) to disable; anything
// else — including unset — leaves the feature ON. To disable in Vercel, add the
// env var to the project (Production/Preview) and redeploy.

export type FeatureFlag =
  | "csvImport"
  | "risk"
  | "xray"
  | "rebalance"
  | "simulation"
  | "simulationPortfolio"
  | "simulationCustom"
  | "simulationWithdrawal";

/** Parse an env flag: unset/empty → default (on); "0"/"false"/"off" → off. */
function parse(value: string | undefined, def = true): boolean {
  if (value == null || value === "") return def;
  const v = value.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

// Static literals so Next can inline them. Do not refactor into a loop.
const FEATURES: Record<FeatureFlag, boolean> = {
  csvImport: parse(process.env.NEXT_PUBLIC_FEATURE_CSV_IMPORT),
  risk: parse(process.env.NEXT_PUBLIC_FEATURE_RISK),
  xray: parse(process.env.NEXT_PUBLIC_FEATURE_XRAY),
  rebalance: parse(process.env.NEXT_PUBLIC_FEATURE_REBALANCE),
  simulation: parse(process.env.NEXT_PUBLIC_FEATURE_SIMULATION),
  simulationPortfolio: parse(process.env.NEXT_PUBLIC_FEATURE_SIMULATION_PORTFOLIO),
  simulationCustom: parse(process.env.NEXT_PUBLIC_FEATURE_SIMULATION_CUSTOM),
  simulationWithdrawal: parse(process.env.NEXT_PUBLIC_FEATURE_SIMULATION_WITHDRAWAL),
};

/** Whether a feature is enabled in this environment. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  // A sub-feature of the simulation is only available if the simulation is.
  if (
    (flag === "simulationPortfolio" ||
      flag === "simulationCustom" ||
      flag === "simulationWithdrawal") &&
    !FEATURES.simulation
  ) {
    return false;
  }
  return FEATURES[flag];
}
