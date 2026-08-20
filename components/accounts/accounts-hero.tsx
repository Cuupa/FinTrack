"use client";

// The accounts summary + curve: what the selected accounts hold, how that moved
// over the window, and the optional history behind it -- the same shape
// /portfolio uses for the depot, so the two areas read as one product (owner
// rule, round 28).
//
// Split into two pieces the Konten tab stacks (UX-Unification-Spec §10.1):
//   AccountsSummary -- the SummaryStrip of headline figures, at the top.
//   AccountsChart   -- the optional history of the selected group, at the
//                      bottom, demoted below the list so the (often negative)
//                      net figure no longer dominates the whole page.
//
// The account picker is the page's filter, not just the chart's: whatever is
// selected in the header also narrows the bookings below. It is a MULTI-select
// (owner call): "how much do my two current accounts hold together" and "what
// did I spend out of either card" are ordinary questions. An EMPTY selection
// means every account, rather than a sentinel option sitting in the list.
//
// No benchmarks and no return mode, unlike the depot hero. An account balance
// is a figure the user SETS, carried forward between readings -- there is no
// price series to compare against an index. And a balance is a STOCK, not a
// judgement, so it is shown neutral: only the CHANGE over the window carries
// semantic color (spec §6, "Bestandswert ist zunächst weiß").

import { useMemo } from "react";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { accountsTotals, accountsValueSeries } from "@/lib/finance/accounts";
import {
  dateRange,
  lastDayOfMonth,
  timeframeStart,
  today,
  type Timeframe,
} from "@/lib/finance/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { SummaryStrip, type SummaryMetric } from "@/components/ui/summary-strip";
import { ChartControls } from "@/components/charts/chart-controls";
import { canLogScale, PerformanceChart, type ChartScale } from "@/components/charts/performance-chart";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { Account } from "@/lib/types";

/** The accounts the header's selection resolves to (empty = every account),
 *  filtered against the live list so a since-deleted id drops out. */
function useSelectedAccounts(accountIds: string[]): Account[] {
  const { data } = usePortfolio();
  return useMemo(
    () =>
      accountIds.length === 0
        ? data.accounts
        : data.accounts.filter((a) => accountIds.includes(a.id)),
    [data.accounts, accountIds],
  );
}

/** The value series for the selected accounts over the chosen window, plus the
 *  raw change across it. Shared by the summary (which shows the change) and the
 *  chart (which plots the series). */
function useAccountsSeries(
  selected: Account[],
  timeframe: Timeframe,
  month: string | null,
) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const movements = useAccountMovements();
  return useMemo(() => {
    if (selected.length === 0) return { series: [] as { date: string; value: number }[], change: 0 };
    const todayIso = today();
    let earliest = selected[0].openedOn;
    for (const a of selected) if (a.openedOn < earliest) earliest = a.openedOn;
    const monthEnd = month ? lastDayOfMonth(`${month}-01`) : null;
    const end = monthEnd && monthEnd < todayIso ? monthEnd : todayIso;
    const start = month ? `${month}-01` : timeframeStart(timeframe, end, earliest);
    if (end < earliest) return { series: [], change: 0 };
    const dates = dateRange(start < earliest ? earliest : start, end);
    const values = accountsValueSeries(selected, data.accountBalances, dates, valuation, movements);
    const series = dates.map((date, i) => ({ date, value: values[i] }));
    const change = series.length < 2 ? 0 : series[series.length - 1].value - series[0].value;
    return { series, change };
  }, [selected, data.accountBalances, timeframe, valuation, movements, month]);
}

export function AccountsSummary({
  accountIds,
  timeframe,
  month = null,
}: {
  accountIds: string[];
  timeframe: Timeframe;
  month?: string | null;
}) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t, locale } = useI18n();
  const base = data.profile.currency;
  const movements = useAccountMovements();

  const selected = useSelectedAccounts(accountIds);
  const totals = useMemo(
    () => accountsTotals(selected, data.accountBalances, valuation, movements),
    [selected, data.accountBalances, valuation, movements],
  );
  const { change } = useAccountsSeries(selected, timeframe, month);

  const one = accountIds.length > 0 && selected.length === 1 ? selected[0] : undefined;
  const changeScope = month
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
        new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)),
      )
    : timeframe;

  const metrics: SummaryMetric[] = [
    // Stock values, neutral: a balance is not a verdict.
    { label: t("accounts.summary.balance"), value: formatCurrency(totals.assets, base), isPrivate: true },
    {
      label: t("accounts.summary.creditBalances"),
      value: formatCurrency(totals.liabilities, base),
      isPrivate: true,
    },
    // The one delta on the strip, so the one figure that carries semantic color.
    {
      label: t("accounts.hero.change", { timeframe: changeScope }),
      value: formatCurrency(change, base),
      valueClassName: change < 0 ? "text-negative" : change > 0 ? "text-positive" : "text-primary",
      isPrivate: true,
    },
    one
      ? {
          label: t("accounts.list.kind"),
          value: t(`accounts.kind.${one.kind}` as Parameters<typeof t>[0]),
        }
      : { label: t("accounts.summary.count"), value: String(selected.length) },
  ];

  return <SummaryStrip metrics={metrics} dataTour="accounts-totals" />;
}

export function AccountsChart({
  accountIds,
  timeframe,
  onTimeframe,
  scale,
  onScale,
  month = null,
}: {
  accountIds: string[];
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  scale: ChartScale;
  onScale: (s: ChartScale) => void;
  month?: string | null;
}) {
  const { t } = useI18n();
  const { data } = usePortfolio();
  const base = data.profile.currency;

  const selected = useSelectedAccounts(accountIds);
  const { series, change } = useAccountsSeries(selected, timeframe, month);

  const one = accountIds.length > 0 && selected.length === 1 ? selected[0] : undefined;
  const filtered = accountIds.length > 0;
  const scopeLabel = one
    ? one.name
    : filtered
      ? t("select.nSelected", { count: String(selected.length) })
      : t("accounts.hero.all");

  return (
    <Card>
      <h2 className="text-lg font-semibold text-primary">{t("accounts.chart.title")}</h2>
      {/* A timeframe strip means nothing inside a single month: the header's
          month picker already bounds the curve at both ends. */}
      {!month && (
        <div className="mt-4">
          <ChartControls
            timeframe={timeframe}
            onTimeframe={onTimeframe}
            scale={scale}
            onScale={onScale}
            mode="currency"
            onMode={() => {}}
            showMode={false}
            scaleAvailable={canLogScale(series)}
          />
        </div>
      )}

      <div className="mt-3">
        {series.length < 2 ? (
          <p className="py-10 text-center text-sm text-tertiary">{t("accounts.hero.noChart")}</p>
        ) : (
          <PerformanceChart
            series={series}
            scale={scale}
            mode="currency"
            currency={base}
            mainLabel={scopeLabel}
            ariaLabel={t("accounts.hero.chartAria", {
              scope: scopeLabel,
              start: formatDate(series[0].date),
              end: formatDate(series[series.length - 1].date),
              change: formatCurrency(change, base),
            })}
          />
        )}
      </div>
    </Card>
  );
}
