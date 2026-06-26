"use client";

// Allocation pie charts: distribution by investment, asset class, currency,
// country and volatility band.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import {
  byAssetClass,
  byCountry,
  byCurrency,
  byInvestment,
  byVolatility,
} from "@/lib/finance/allocation";
import { Card } from "@/components/ui/primitives";
import { AllocationPie } from "./allocation-pie";

export function AllocationView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const base = data.profile.currency;

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  const charts = useMemo(
    () => ({
      investment: byInvestment(holdings),
      assetClass: byAssetClass(holdings),
      currency: byCurrency(holdings, base),
      country: byCountry(holdings),
      volatility: byVolatility(holdings),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, base, version],
  );

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">Add holdings to see your allocation.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <AllocationPie title="By investment" slices={charts.investment} currency={base} />
      <AllocationPie title="By asset class" slices={charts.assetClass} currency={base} />
      <AllocationPie title="By currency" slices={charts.currency} currency={base} />
      <AllocationPie title="By country / region" slices={charts.country} currency={base} />
      <AllocationPie title="By volatility" slices={charts.volatility} currency={base} />
    </div>
  );
}
