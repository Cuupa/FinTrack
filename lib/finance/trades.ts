// Trade analytics: realised P&L per month and best/worst holdings, derived by
// replaying the transaction log. All figures are in the base currency.

import type { Asset, Transaction } from "../types";
import type { HoldingSummary, ValuationContext } from "./portfolio";

function rateOf(asset: Asset, v?: ValuationContext): number {
  const cur = asset.currency ?? v?.base ?? "";
  if (!v || !cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

const byDateAsc = (a: Transaction, b: Transaction) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

export interface MonthlyRealized {
  /** YYYY-MM */
  month: string;
  realized: number;
}

/**
 * Realised P&L attributed to the month each sell occurred (average-cost basis at
 * the time of the sell), in base currency.
 */
export function realizedByMonth(
  assets: Asset[],
  txs: Transaction[],
  v?: ValuationContext,
): MonthlyRealized[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const byAsset = new Map<string, Transaction[]>();
  for (const t of txs) {
    const list = byAsset.get(t.assetId);
    if (list) list.push(t);
    else byAsset.set(t.assetId, [t]);
  }

  const monthly = new Map<string, number>();
  for (const [assetId, atxs] of byAsset) {
    const asset = byId.get(assetId);
    if (!asset) continue;
    const rate = rateOf(asset, v);
    let shares = 0;
    let avgCost = 0;
    for (const t of [...atxs].sort(byDateAsc)) {
      if (t.type === "BUY" || t.type === "BOOKING" || t.type === "INTEREST") {
        // BOOKING (free crediting) and INTEREST (cash interest credit) both add
        // shares at zero cost — only a fee/tax (if any) raises the basis, so the
        // whole value becomes realised profit on sale.
        const cost = t.type === "BUY" ? t.quantity * t.price + t.fee + t.tax : t.fee + t.tax;
        const ns = shares + t.quantity;
        avgCost = ns > 0 ? (shares * avgCost + cost) / ns : 0;
        shares = ns;
      } else if (t.type === "SPLIT") {
        // Stock split: quantity is the ratio. Scales shares/avgCost only —
        // never a realised-P&L event, so it must not fall into the SELL arm
        // below.
        const ratio = t.quantity;
        if (ratio > 0) {
          shares *= ratio;
          avgCost = avgCost / ratio;
        }
      } else {
        const proceeds = t.quantity * t.price - t.fee - t.tax;
        const realized = (proceeds - t.quantity * avgCost) * rate;
        const month = t.date.slice(0, 7);
        monthly.set(month, (monthly.get(month) ?? 0) + realized);
        shares -= t.quantity;
        if (shares <= 1e-9) {
          shares = 0;
          avgCost = 0;
        }
      }
    }
  }

  return Array.from(monthly, ([month, realized]) => ({ month, realized })).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );
}

export interface Mover {
  id: string;
  name: string;
  symbol: string | null;
  /** Total P&L (realised + unrealised), base currency. */
  pl: number;
  /** Unrealised return on still-held shares, fraction. */
  plPercent: number;
}

/** Best and worst holdings by total P&L. */
export function topMovers(
  holdings: HoldingSummary[],
  n = 5,
): { wins: Mover[]; losses: Mover[] } {
  const movers: Mover[] = holdings
    .filter((h) => h.position.shares > 0 || h.realizedPL !== 0)
    .map((h) => ({
      id: h.asset.id,
      name: h.asset.name,
      symbol: h.asset.symbol,
      pl: h.unrealizedPL + h.realizedPL,
      plPercent: h.unrealizedPLPercent,
    }));
  const wins = movers.filter((m) => m.pl > 0).sort((a, b) => b.pl - a.pl).slice(0, n);
  const losses = movers.filter((m) => m.pl < 0).sort((a, b) => a.pl - b.pl).slice(0, n);
  return { wins, losses };
}
