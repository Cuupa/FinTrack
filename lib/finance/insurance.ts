// Insurance register + coverage prompts (ROADMAP item #10, flag `insurance`)
// — pure, no React, no lib/server imports. Insurance rows are typed
// `Contract`s (ROADMAP #5): this module only derives which of a core DACH
// household coverage set has no matching contract, for a gentle prompt --
// never a hard requirement, never advice on how much coverage to buy.

import type { Contract, InsuranceType } from "../types";

/**
 * The baseline coverage most German/Austrian/Swiss households are advised to
 * carry: private liability, health, household contents, and legal
 * protection. Deliberately excludes life/disability/vehicle -- those depend
 * on personal circumstances (dependants, employment, car ownership) in a way
 * the other four don't, so flagging their absence would be presumptuous.
 */
export const CORE_INSURANCE_TYPES: InsuranceType[] = ["liability", "health", "household", "legal"];

/**
 * Core insurance types with no matching contract in the register, in
 * `CORE_INSURANCE_TYPES` order. A type counts as covered as soon as one
 * contract carries it, regardless of amount/sum insured.
 */
export function coverageGaps(contracts: Contract[]): InsuranceType[] {
  const covered = new Set(
    contracts.map((c) => c.insuranceType).filter((t): t is InsuranceType => !!t),
  );
  return CORE_INSURANCE_TYPES.filter((t) => !covered.has(t));
}
