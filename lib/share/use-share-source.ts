"use client";

// Builds the ShareSource (allocation + TWROR/wealth series + IRR + holdings)
// from a set of transactions + real price history. Shared by the Share menu and
// the live-share refresher so both produce identical snapshots.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import {
  netWorthSeries,
  summarizeAll,
  twrSeries,
  type ValuationContext,
} from "@/lib/finance/portfolio";
import { netFlows } from "@/lib/finance/returns";
import { portfolioIRR } from "@/lib/finance/irr";
import type { HistoryMap } from "@/lib/history/history";
import type { Asset, Transaction } from "@/lib/types";
import type { ShareSource } from "./share";

/** Pure builder — used by the hook and the live-share refresher. */
export function buildShareSource(args: {
  assets: Asset[];
  transactions: Transaction[];
  valuation: ValuationContext;
  histories: HistoryMap;
  ownerName: string | null;
  currency: string;
  portfolioIds: string[] | null;
}): ShareSource {
  const { assets, transactions, valuation, histories, ownerName, currency, portfolioIds } = args;
  const holdings = summarizeAll(assets, transactions, valuation).filter(
    (h) => h.position.shares > 0,
  );
  const netWorth = holdings.reduce((s, h) => s + h.marketValue, 0);
  const wealthSeries = netWorthSeries(assets, transactions, "MAX", valuation, histories).points;
  const twr = twrSeries(assets, transactions, "MAX", valuation, histories);
  const flows = netFlows(assets, transactions, valuation).map((f) => ({
    date: f.date,
    amount: -f.amount,
  }));
  return {
    ownerName,
    portfolioIds,
    currency,
    netWorth,
    irr: portfolioIRR(flows, netWorth),
    twr: twr.length ? twr[twr.length - 1].value : null,
    twrSeries: twr,
    wealthSeries,
    holdings: holdings.map((h) => ({
      name: h.asset.name,
      type: h.asset.type,
      marketValue: h.marketValue,
      ret: h.unrealizedPLPercent,
    })),
  };
}

/**
 * Build the share source for an explicit set of portfolio ids (null = all the
 * user's). Price history is fetched once for every asset.
 */
export function useShareSource(portfolioIds: string[] | null): {
  source: ShareSource;
  loading: boolean;
} {
  const { data, portfolios, allTransactions } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const currency = data.profile.currency;

  const histItems = useMemo(
    () =>
      data.assets.map(quoteItemFor).filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories, fx, loading } = useHistory(histItems, "MAX", currency);

  // Layers the fetched historical FX series onto the live valuation so
  // buildShareSource's netWorthSeries/twrSeries convert each historical point
  // at the FX rate of ITS OWN date instead of today's spot rate (rateOn in
  // portfolio.ts). Referentially equal to `valuation` when there's no fx yet.
  const effectiveValuation = useMemo(() => {
    if (!fx || Object.keys(fx).length === 0) return valuation;
    return { ...valuation, fxHistory: fx };
  }, [valuation, fx]);

  const idsKey = (portfolioIds ?? portfolios.map((p) => p.id)).join(",");
  const transactions = useMemo(
    () =>
      portfolioIds === null
        ? allTransactions
        : allTransactions.filter((t) => portfolioIds.includes(t.portfolioId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTransactions, idsKey],
  );

  const source = useMemo<ShareSource>(
    () =>
      buildShareSource({
        assets: data.assets,
        transactions,
        valuation: effectiveValuation,
        histories,
        ownerName: data.profile.name ?? null,
        currency,
        portfolioIds,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, transactions, effectiveValuation, histories, currency, idsKey, data.profile.name],
  );

  return { source, loading };
}
