// Synthetic dividend history (PRD detail panel: dividend history + yield).
//
// Like prices.ts, this is a deterministic stand-in for a real data feed:
// dividend-paying asset types get quarterly payments sized from an annual
// yield, scaled by the shares actually held on each pay date.

import { assetPriceKey, type Asset, type Transaction } from "../types";
import { lookupInstrument } from "../catalog/catalog";
import { addDays, today } from "./dates";
import { currentPrice } from "./prices";
import { sharesAt } from "./portfolio";

export interface DividendPayment {
  date: string;
  /** Per-share amount in base currency. */
  perShare: number;
  shares: number;
  total: number;
}

/**
 * Annual dividend yield for an asset. Sourced from the instruments catalog
 * (database), not hardcoded — unknown assets yield 0.
 */
export function annualYield(asset: Asset): number {
  if (asset.type === "CRYPTO" || asset.type === "CASH") return 0;
  const inst = lookupInstrument(assetPriceKey(asset));
  return inst?.dividendYield ?? 0;
}

/** Quarterly dividend payments over the period the asset was held. */
export function dividendHistory(
  asset: Asset,
  txs: Transaction[],
): DividendPayment[] {
  const y = annualYield(asset);
  if (y <= 0 || txs.length === 0) return [];

  const price = currentPrice(assetPriceKey(asset), asset.type);
  const perShareQuarter = (price * y) / 4;
  const firstDate = txs.reduce(
    (min, t) => (t.date < min ? t.date : min),
    txs[0].date,
  );

  const payments: DividendPayment[] = [];
  // Pay every ~91 days from first holding until today.
  let payDate = addDays(firstDate, 91);
  const end = today();
  let guard = 0;
  while (payDate <= end && guard++ < 200) {
    const shares = sharesAt(txs, payDate);
    if (shares > 0) {
      payments.push({
        date: payDate,
        perShare: perShareQuarter,
        shares,
        total: perShareQuarter * shares,
      });
    }
    payDate = addDays(payDate, 91);
  }
  return payments;
}

export function totalDividends(payments: DividendPayment[]): number {
  return payments.reduce((s, p) => s + p.total, 0);
}
