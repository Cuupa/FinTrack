"use client";

// Allocation analysis: one pie chart, with tabs to switch the breakdown
// (investments, asset classes, currencies, countries, volatility).

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import {
  byAssetClass,
  byCountry,
  byCurrency,
  byInvestment,
  byRegion,
  bySector,
  byVolatility,
  type Slice,
} from "@/lib/finance/allocation";
import { useClassifications } from "@/lib/finance/use-classifications";
import { useEtfSectors } from "@/lib/finance/use-etf-sectors";
import { Card } from "@/components/ui/primitives";
import { AllocationPie } from "./allocation-pie";

const TABS = [
  { key: "investment", label: "Investments" },
  { key: "assetClass", label: "Asset Classes" },
  { key: "sector", label: "Sectors" },
  { key: "region", label: "Region" },
  { key: "currency", label: "Currencies" },
  { key: "country", label: "Countries" },
  { key: "volatility", label: "Volatility" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AllocationView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const base = data.profile.currency;

  const [tab, setTab] = useState<TabKey>("assetClass");

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  // Online-fetched classifications for custom stocks the catalog doesn't know.
  const classMap = useClassifications(holdings, version);
  // Online-fetched per-ETF sector weightings (full fund sector breakdown).
  const etfSectors = useEtfSectors(holdings, version);

  const charts = useMemo<Record<TabKey, Slice[]>>(
    () => ({
      investment: byInvestment(holdings),
      assetClass: byAssetClass(holdings),
      sector: bySector(holdings, classMap, etfSectors),
      region: byRegion(holdings, classMap),
      currency: byCurrency(holdings, base),
      country: byCountry(holdings),
      volatility: byVolatility(holdings),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, base, version, classMap, etfSectors],
  );

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">Add holdings to see your allocation.</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <AllocationPie slices={charts[tab]} currency={base} />
      </div>
    </Card>
  );
}
