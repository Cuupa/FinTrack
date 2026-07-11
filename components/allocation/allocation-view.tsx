"use client";

// Allocation analysis: one pie chart, with tabs to switch the breakdown
// (investments, asset classes, currencies, countries, volatility).

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TABS as readonly string[]).includes(value);
}

export function AllocationView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const base = data.profile.currency;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL (`?breakdown=`) mirrors the client state, read once on mount;
  // state stays authoritative and pushes to the URL on change (see
  // selectTab), so there's no URL -> state sync loop.
  const requestedBreakdown = searchParams.get("breakdown");
  const [tab, setTab] = useState<TabKey>(
    isTabKey(requestedBreakdown) ? requestedBreakdown : "investment",
  );

  const selectTab = (key: TabKey) => {
    setTab(key);
    const params = new URLSearchParams(searchParams.toString());
    params.set("breakdown", key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

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

  // One breakdown per tag group instead of a single selectable pie: every
  // group gets its own byCustom() slice set. A group is "empty" (hidden) when
  // no holding has a value in it, i.e. its only slice is the Untagged
  // sentinel (or it has none at all). Only the "Untagged" sentinel is
  // translated; user tag values are real data and must never be run through
  // the label vocabulary. The empty check stays against the canonical,
  // untranslated slices on purpose, so it keeps matching regardless of locale.
  const customGroupCharts = useMemo(
    () =>
      groups
        .map((group) => {
          const slices = byCustom(holdings, assignments, group.id);
          const empty = slices.every((s) => s.label === "Untagged");
          const translated = slices.map((s) =>
            s.label === "Untagged" ? { ...s, label: t("alloc.untagged") } : s,
          );
          const colors = slices.map((s) =>
            s.label === "Untagged" ? "#a1a1aa" : colorForLabel(s.label),
          );
          return { group, slices: translated, colors, empty };
        })
        .filter((c) => !c.empty),
    [groups, holdings, assignments, t],
  );

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("alloc.addHoldings")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        {/* Breakdown selector: a contained pill group, distinct from the page's
            primary underline tabs. */}
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/50">
          {TABS.map((key) => (
            <button
              key={key}
              onClick={() => selectTab(key)}
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

        {tab !== "custom" && (
          <div className="mt-8">
            {charts[tab].length === 0 ? (
              <p className="py-12 text-center text-sm text-zinc-500">
                {tab === "region" || tab === "country" ? t("alloc.noGeo") : t("alloc.noData")}
              </p>
            ) : (
              <AllocationPie slices={charts[tab]} currency={base} title={t(`alloc.${tab}`)} />
            )}
          </div>
        )}
      </Card>

      {tab === "custom" &&
        (customGroupCharts.length === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-zinc-500">{t("alloc.noTags")}</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {customGroupCharts.map(({ group, slices, colors }) => (
              <Card key={group.id}>
                <h3 className="text-sm font-semibold">{group.name}</h3>
                <div className="mt-4">
                  <AllocationPie slices={slices} currency={base} title={group.name} colors={colors} />
                </div>
              </Card>
            ))}
          </div>
        ))}
    </div>
  );
}
