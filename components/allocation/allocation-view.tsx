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
  byCustom,
  byInvestment,
  byRegion,
  bySector,
  byVolatility,
  type Slice,
} from "@/lib/finance/allocation";
import { useTags } from "@/lib/tags/tags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { colorForLabel } from "@/lib/colors";
import { useClassifications } from "@/lib/finance/use-classifications";
import { useEtfSectors } from "@/lib/finance/use-etf-sectors";
import { useEtfRegions } from "@/lib/finance/use-etf-regions";
import { useEtfCountries } from "@/lib/finance/use-etf-countries";
import { Card } from "@/components/ui/primitives";
import { AllocationPie } from "./allocation-pie";

const TABS = [
  "investment",
  "assetClass",
  "sector",
  "region",
  "country",
  "currency",
  "volatility",
  "custom",
] as const;

type TabKey = (typeof TABS)[number];

export function AllocationView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const base = data.profile.currency;

  const [tab, setTab] = useState<TabKey>("investment");

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  // Online-fetched classifications for custom stocks the catalog doesn't know.
  const classMap = useClassifications(holdings, version);
  // Online-fetched per-ETF sector + region weightings (full fund breakdowns).
  const etfSectors = useEtfSectors(holdings, version);
  const etfRegions = useEtfRegions(holdings, version);
  const etfCountries = useEtfCountries(holdings, version);
  const { tags } = useTags();
  const { t } = useI18n();

  const charts = useMemo<Record<TabKey, Slice[]>>(
    () => ({
      investment: byInvestment(holdings),
      assetClass: byAssetClass(holdings),
      sector: bySector(holdings, classMap, etfSectors),
      region: byRegion(holdings, classMap, etfRegions),
      country: byCountryLookThrough(holdings, classMap, etfCountries),
      currency: byCurrency(holdings, base),
      volatility: byVolatility(holdings),
      custom: byCustom(holdings, tags),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, base, version, classMap, etfSectors, etfRegions, etfCountries, tags],
  );

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("alloc.addHoldings")}</p>
      </Card>
    );
  }

  return (
    <Card>
      {/* Breakdown selector: a contained pill group, distinct from the page's
          primary underline tabs. */}
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/50">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t(`alloc.${key}`)}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "custom" && charts.custom.every((s) => s.label === "Untagged") ? (
          <p className="py-6 text-center text-sm text-zinc-500">{t("alloc.noTags")}</p>
        ) : charts[tab].length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            {tab === "region" || tab === "country" ? t("alloc.noGeo") : t("alloc.noData")}
          </p>
        ) : (
          <AllocationPie
            slices={charts[tab]}
            currency={base}
            colors={
              tab === "custom"
                ? charts.custom.map((s) =>
                    s.label === "Untagged" ? "#a1a1aa" : colorForLabel(s.label),
                  )
                : undefined
            }
          />
        )}
      </div>
    </Card>
  );
}
