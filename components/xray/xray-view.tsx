"use client";

// Portfolio X-ray: look-through exposure to individual stocks, combining ETF
// constituents with directly-held positions.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { xrayPortfolio } from "@/lib/finance/xray";
import { hasConstituents } from "@/lib/catalog/catalog";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card, EmptyState, SectionTitle } from "@/components/ui/primitives";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { useI18n } from "@/lib/i18n/i18n-context";

type SortKey = "name" | "heldVia" | "value" | "percent";

export function XrayView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog(); // recompute once constituents load
  const { t } = useI18n();
  const { sort, toggle, apply } = useSort<SortKey>("percent", "desc");

  const xray = useMemo(() => {
    const holdings = summarizeAll(data.assets, data.transactions, valuation).filter(
      (h) => h.position.shares > 0,
    );
    return xrayPortfolio(holdings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assets, data.transactions, valuation, version]);

  const currency = data.profile.currency;

  const heldVia = (e: (typeof xray.exposures)[number]) =>
    e.sources
      .map((s) => (s.viaEtf ? s.holdingName : `${s.holdingName} (${t("xray.direct")})`))
      .join(", ");

  const rows = useMemo(
    () =>
      apply(xray.exposures, (e, key) => {
        if (key === "name") return e.name;
        if (key === "heldVia") return heldVia(e);
        if (key === "value") return e.value;
        return e.percent;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [xray.exposures, apply],
  );

  if (data.assets.length === 0) {
    return (
      <Card>
        <EmptyState title={t("xray.addHoldings")} />
      </Card>
    );
  }

  if (xray.exposures.length === 0) {
    return (
      <Card>
        <EmptyState title={hasConstituents() ? t("xray.noData") : t("xray.noCatalog")} />
      </Card>
    );
  }

  // The widest bar in the table, not the first row's: the rows can now be
  // sorted by any column, so position no longer implies magnitude.
  const maxPercent = Math.max(...xray.exposures.map((e) => e.percent), 0) || 1;

  return (
    <Card data-tour="xray-table">
      <SectionTitle
        actions={
          <p className="text-sm text-zinc-500">
            {formatNumber((xray.classified / (xray.total || 1)) * 100, 0)}% {t("xray.inEquities")} ·{" "}
            <span data-private>{formatCurrency(xray.unclassified, currency)}</span>{" "}
            {t("xray.otherNonEquity")}
          </p>
        }
      >
        {t("xray.stockExposure")}
      </SectionTitle>

      <Table className="mt-4">
        <Thead>
          <Th sort={sort} sortKey="name" onSort={toggle}>
            {t("xray.colStock")}
          </Th>
          <Th sort={sort} sortKey="heldVia" onSort={toggle}>
            {t("xray.colHeldVia")}
          </Th>
          <Th align="right" sort={sort} sortKey="value" onSort={toggle}>
            {t("xray.colExposure")}
          </Th>
          <Th align="right" sort={sort} sortKey="percent" onSort={toggle}>
            {t("xray.colPct")}
          </Th>
        </Thead>
        <Tbody>
          {rows.map((e) => (
            <Tr key={e.key}>
              <Td>
                <span className="font-medium">{e.name}</span>
                {e.symbol && (
                  <span className="ml-1 font-mono text-xs text-zinc-500">{e.symbol}</span>
                )}
              </Td>
              <Td className="text-xs text-zinc-500">{heldVia(e)}</Td>
              <Td align="right" className="tabular-nums" data-private>
                {formatCurrency(e.value, currency)}
              </Td>
              <Td align="right" className="tabular-nums">
                <div className="flex items-center justify-end gap-2">
                  <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100 sm:block dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${(e.percent / maxPercent) * 100}%` }}
                    />
                  </div>
                  <span className="w-14 text-right tabular-nums">
                    {formatNumber(e.percent * 100, 2)}%
                  </span>
                </div>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <p className="mt-3 text-xs text-zinc-500">{t("xray.footnote")}</p>
    </Card>
  );
}
