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
import { translateSliceLabel } from "@/lib/i18n/slice-label";
import { colorForLabel } from "@/lib/colors";
import { useClassifications } from "@/lib/finance/use-classifications";
import { useEtfSectors } from "@/lib/finance/use-etf-sectors";
import { useEtfRegions } from "@/lib/finance/use-etf-regions";
import { useEtfCountries } from "@/lib/finance/use-etf-countries";
import { Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
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
type OtherTabKey = Exclude<TabKey, "custom">;

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
  const { groups, assignments } = useTags();
  const { t } = useI18n();

  // Which tag group backs the Custom breakdown. Derived rather than synced
  // via effect: falls back to the first group whenever the selection is
  // empty or points at a group that's since been deleted.
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const activeGroupId = groups.some((g) => g.id === selectedGroupId)
    ? selectedGroupId
    : (groups[0]?.id ?? "");

  const charts = useMemo<Record<OtherTabKey, Slice[]>>(() => {
    // The finance layer is pure and locale-agnostic (English canonical
    // labels only); translate the breakdowns whose labels come from a fixed
    // vocabulary (asset class, sector, region, volatility). Investment and
    // currency labels are real data (names/codes), left untranslated.
    const translate = (slices: Slice[]): Slice[] =>
      slices.map((s) => ({ ...s, label: translateSliceLabel(s.label, t) }));
    return {
      investment: byInvestment(holdings),
      assetClass: translate(byAssetClass(holdings)),
      sector: translate(bySector(holdings, classMap, etfSectors)),
      region: translate(byRegion(holdings, classMap, etfRegions)),
      country: translate(byCountryLookThrough(holdings, classMap, etfCountries)),
      currency: byCurrency(holdings, base),
      volatility: translate(byVolatility(holdings)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, base, version, classMap, etfSectors, etfRegions, etfCountries, t]);

  // Kept separate from `charts`: it depends on the selected tag group instead
  // of the catalog/classification data the other breakdowns depend on.
  const customSlices = useMemo(
    () => byCustom(holdings, assignments, activeGroupId),
    [holdings, assignments, activeGroupId],
  );

  // Only the "Untagged" sentinel is translated; user tag values are real data
  // and must never be run through the label vocabulary. The empty-state and
  // gray-color checks below stay against `customSlices` (canonical, untranslated)
  // on purpose, so they keep matching regardless of locale.
  const translatedCustomSlices = useMemo(
    () =>
      customSlices.map((s) => (s.label === "Untagged" ? { ...s, label: t("alloc.untagged") } : s)),
    [customSlices, t],
  );

  const activeSlices = tab === "custom" ? translatedCustomSlices : charts[tab];

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

      {tab === "custom" && groups.length > 0 && (
        <div className="mt-4 max-w-xs">
          <SelectMenu
            value={activeGroupId}
            ariaLabel={t("alloc.selectGroup")}
            onChange={setSelectedGroupId}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </div>
      )}

      <div className="mt-8">
        {tab === "custom" && customSlices.every((s) => s.label === "Untagged") ? (
          <p className="py-6 text-center text-sm text-zinc-500">{t("alloc.noTags")}</p>
        ) : activeSlices.length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            {tab === "region" || tab === "country" ? t("alloc.noGeo") : t("alloc.noData")}
          </p>
        ) : (
          <AllocationPie
            slices={activeSlices}
            currency={base}
            title={t(`alloc.${tab}`)}
            colors={
              tab === "custom"
                ? customSlices.map((s) =>
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
