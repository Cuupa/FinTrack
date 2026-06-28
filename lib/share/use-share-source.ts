"use client";

// Builds the ShareSource (allocation + TWROR/wealth series + IRR + holdings)
// from the current portfolio + real price history. Shared by the Share menu and
// the live-share refresher so both produce identical snapshots.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { netWorthSeries, summarizeAll, twrSeries } from "@/lib/finance/portfolio";
import { netFlows } from "@/lib/finance/returns";
import { portfolioIRR } from "@/lib/finance/irr";
import type { ShareSource } from "./share";

export function useShareSource(): { source: ShareSource; loading: boolean } {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const currency = data.profile.currency;

  const histItems = useMemo(
    () =>
      data.assets.map(quoteItemFor).filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories, loading } = useHistory(histItems, "MAX", currency);

  const source = useMemo<ShareSource>(() => {
    const holdings = summarizeAll(data.assets, data.transactions, valuation).filter(
      (h) => h.position.shares > 0,
    );
    const netWorth = holdings.reduce((s, h) => s + h.marketValue, 0);
    const wealthSeries = netWorthSeries(data.assets, data.transactions, "MAX", valuation, histories);
    const twr = twrSeries(data.assets, data.transactions, "MAX", valuation, histories);
    const flows = netFlows(data.assets, data.transactions, valuation).map((f) => ({
      date: f.date,
      amount: -f.amount,
    }));
    return {
      ownerName: data.profile.name ?? null,
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
  }, [data, valuation, histories, currency]);

  return { source, loading };
}
