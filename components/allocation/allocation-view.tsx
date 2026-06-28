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
  byCountryLookThrough,
  byCurrency,
  byInvestment,
  byRegion,
  bySector,
  byVolatility,
  type Slice,
} from "@/lib/finance/allocation";
import { useClassifications } from "@/lib/finance/use-classifications";
import { useEtfSectors } from "@/lib/finance/use-etf-sectors";
import { useEtfRegions } from "@/lib/finance/use-etf-regions";
import { useEtfCountries } from "@/lib/finance/use-etf-countries";
import { Card } from "@/components/ui/primitives";
import { ScopeSelect } from "@/components/analysis/scope-select";
import { AllocationPie } from "./allocation-pie";

const TABS = [
  { key: "investment", label: "Investments" },
  { key: "assetClass", label: "Asset Classes" },
  { key: "sector", label: "Sectors" },
  { key: "region", label: "Region" },
  { key: "country", label: "Countries" },
  { key: "currency", label: "Currencies" },
  { key: "volatility", label: "Volatility" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AllocationView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const base = data.profile.currency;

  const [tab, setTab] = useState<TabKey>("assetClass");
  // Scope: empty = portfolio-wide; otherwise restrict to the selected assets.
  const [scope, setScope] = useState<string[]>([]);

  const allHoldings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  const holdings = useMemo(
    () => (scope.length === 0 ? allHoldings : allHoldings.filter((h) => scope.includes(h.asset.id))),
    [allHoldings, scope],
  );

  const scopeOptions = useMemo(
    () => allHoldings.map((h) => ({ id: h.asset.id, label: h.asset.name })),
    [allHoldings],
  );

  // Online-fetched classifications for custom stocks the catalog doesn't know.
  const classMap = useClassifications(holdings, version);
  // Online-fetched per-ETF sector + region weightings (full fund breakdowns).
  const etfSectors = useEtfSectors(holdings, version);
  const etfRegions = useEtfRegions(holdings, version);
  const etfCountries = useEtfCountries(holdings, version);

  const charts = useMemo<Record<TabKey, Slice[]>>(
    () => ({
      investment: byInvestment(holdings),
      assetClass: byAssetClass(holdings),
      sector: bySector(holdings, classMap, etfSectors),
      region: byRegion(holdings, classMap, etfRegions),
      country: byCountryLookThrough(holdings, classMap, etfCountries),
      currency: byCurrency(holdings, base),
      volatility: byVolatility(holdings),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, base, version, classMap, etfSectors, etfRegions, etfCountries],
  );

  if (allHoldings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">Add holdings to see your allocation.</p>
      </Card>
    );
  }

  return (
    <Card>
      {/* Breakdown selector (pills) + scope multiselect. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/50">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ScopeSelect options={scopeOptions} selected={scope} onChange={setScope} />
      </div>

      <div className="mt-8">
        {charts[tab].length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            {tab === "region" || tab === "country"
              ? "No geographic data yet — run the ETF-breakdowns sync to fetch each fund's country weightings."
              : "No data for this breakdown yet."}
          </p>
        ) : (
          <AllocationPie slices={charts[tab]} currency={base} />
        )}
      </div>
    </Card>
  );
}
