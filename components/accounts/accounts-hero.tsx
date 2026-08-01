"use client";

// The accounts hero: what the selected accounts are worth, how that moved over
// the window, and the curve behind it -- the same shape /portfolio uses for the
// depot, so the two areas read as one product (owner rule, round 28).
//
// The account picker is the page's filter, not just the chart's: whatever is
// selected here also narrows the bookings below. "All accounts" is the default
// and answers the everyday-money question; picking one turns the page into that
// account's statement.
//
// No benchmarks and no return mode, unlike the depot hero. An account balance
// is a figure the user SETS, carried forward between readings -- there is no
// price series to compare against an index, and "time-weighted return" on a
// current account is not a question anyone asks.

import { useMemo } from "react";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { accountsTotals, accountsValueSeries } from "@/lib/finance/accounts";
import { dateRange, timeframeStart, today, type Timeframe } from "@/lib/finance/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ChartControls } from "@/components/charts/chart-controls";
import { PerformanceChart, type ChartScale } from "@/components/charts/performance-chart";
import { useI18n } from "@/lib/i18n/i18n-context";

/** Sentinel for "no account filter". Not an id, so it can never collide. */
export const ALL_ACCOUNTS = "all";

export function AccountsHero({
  accountId,
  onAccount,
  timeframe,
  onTimeframe,
  scale,
  onScale,
}: {
  accountId: string;
  onAccount: (id: string) => void;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  scale: ChartScale;
  onScale: (s: ChartScale) => void;
}) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const movements = useAccountMovements();

  const selected = useMemo(
    () =>
      accountId === ALL_ACCOUNTS ? data.accounts : data.accounts.filter((a) => a.id === accountId),
    [data.accounts, accountId],
  );

  const totals = useMemo(
    () => accountsTotals(selected, data.accountBalances, valuation, movements),
    [selected, data.accountBalances, valuation, movements],
  );

  // The window starts at the oldest opening date in the selection, so "max" on
  // a single account begins when that account did rather than at a global
  // earliest point that has nothing to do with it.
  const series = useMemo(() => {
    if (selected.length === 0) return [];
    const end = today();
    let earliest = selected[0].openedOn;
    for (const a of selected) if (a.openedOn < earliest) earliest = a.openedOn;
    const start = timeframeStart(timeframe, end, earliest);
    const dates = dateRange(start < earliest ? earliest : start, end);
    const values = accountsValueSeries(selected, data.accountBalances, dates, valuation, movements);
    return dates.map((date, i) => ({ date, value: values[i] }));
  }, [selected, data.accountBalances, timeframe, valuation, movements]);

  const change = series.length < 2 ? 0 : series[series.length - 1].value - series[0].value;

  const options = useMemo(
    () => [
      { value: ALL_ACCOUNTS, label: t("accounts.hero.all") },
      ...data.accounts.map((a) => ({ value: a.id, label: a.name })),
    ],
    [data.accounts, t],
  );

  const one = accountId !== ALL_ACCOUNTS ? selected[0] : undefined;
  const scopeLabel = one ? one.name : t("accounts.hero.all");

  return (
    <Card data-tour="accounts-totals">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-zinc-500">
            {one ? t("accounts.hero.oneScope") : t("accounts.hero.allScope")}
          </p>
          <p
            className={`mt-1 text-3xl font-semibold tabular-nums ${
              totals.net < 0 ? "text-red-600 dark:text-red-400" : ""
            }`}
            data-private
          >
            {formatCurrency(totals.net, base)}
          </p>
        </div>
        {/* The page's filter lives with the figure it scopes, exactly like the
            depot's picker sits on its own hero. */}
        <SelectMenu
          className="w-full sm:w-64"
          ariaLabel={t("accounts.hero.pick")}
          value={accountId}
          onChange={onAccount}
          searchable={data.accounts.length > 8}
          options={options}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label={t("accounts.hero.change", { timeframe })}
          value={formatCurrency(change, base)}
          valueClassName={change < 0 ? "text-red-600 dark:text-red-400" : ""}
          isPrivate
        />
        <Stat
          label={t("accounts.totals.assets")}
          value={formatCurrency(totals.assets, base)}
          isPrivate
        />
        <Stat
          label={t("accounts.totals.liabilities")}
          value={formatCurrency(totals.liabilities, base)}
          valueClassName={totals.liabilities > 0 ? "text-red-600 dark:text-red-400" : ""}
          isPrivate
        />
        <Stat
          label={one ? t("accounts.list.kind") : t("accounts.hero.count")}
          value={
            one
              ? t(`accounts.kind.${one.kind}` as Parameters<typeof t>[0])
              : String(data.accounts.length)
          }
        />
      </div>

      <div className="mt-4">
        <ChartControls
          timeframe={timeframe}
          onTimeframe={onTimeframe}
          scale={scale}
          onScale={onScale}
          mode="currency"
          onMode={() => {}}
          showMode={false}
        />
      </div>

      <div className="mt-3">
        {series.length < 2 ? (
          <p className="py-10 text-center text-sm text-zinc-500">{t("accounts.hero.noChart")}</p>
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
