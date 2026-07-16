// Pure per-portfolio broker fee model (settings §"Broker & fees"). These
// helpers only ever PREFILL a transaction/savings-plan form's fee input —
// the user can always edit or clear it before submitting, and nothing here
// writes a fee onto a transaction directly.

import type { Portfolio } from "../types";

/**
 * The order fee for a buy/sell of the given volume (shares × price, in the
 * base currency), given the portfolio's fee model. Waived once `volume`
 * reaches `feeOrderFreeFrom` (when set); otherwise the flat fee applies.
 */
export function orderFee(portfolio: Portfolio | null | undefined, volume: number): number {
  if (!portfolio) return 0;
  const freeFrom = portfolio.feeOrderFreeFrom;
  if (freeFrom != null && volume >= freeFrom) return 0;
  return portfolio.feeOrderFlat ?? 0;
}

/** The fee for one savings-plan execution, given the plan's portfolio. */
export function savingsPlanFee(portfolio: Portfolio | null | undefined): number {
  return portfolio?.feeSavingsPlan ?? 0;
}
