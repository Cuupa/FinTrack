"use client";

// Trades tab: realised P&L per month and the best/worst holdings by total P&L.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import {
  holdingPeriodProfit,
  portfolioTotals,
  summarizeAll,
  transactionsByAsset,
  type HoldingSummary,
  type ValuationContext,
} from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useDividends } from "@/lib/history/use-dividends";
import { dividendsFromEvents, totalDividends } from "@/lib/finance/dividends";
import { realizedByMonth, topMovers, type Mover, type MonthlyRealized } from "@/lib/finance/trades";
import { type Timeframe } from "@/lib/finance/dates";
import { assetPriceKey, type Transaction } from "@/lib/types";
import { formatCurrency, formatPercent, plColor } from "@/lib/format";
import { Card, SegmentedControl, Stat } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { useI18n } from "@/lib/i18n/i18n-context";

const EMERALD = "#10b981";
const RED = "#ef4444";

const TF_OPTIONS: Timeframe[] = ["1M", "3M", "YTD", "1Y", "5Y", "MAX"];

/**
 * Best/worst holdings ranked by profit over a specific timeframe rather than
 * all-time: per holding, the same windowed profit the dashboard's holdings
 * table uses (price change over the window, net of deposits/withdrawals into
 * the position during it), so "1Y" ranks by the last year's movement even for
 * positions opened long ago.
 */
function windowedMovers(
  holdings: HoldingSummary[],
  txs: Transaction[],
  tf: Timeframe,
  v: ValuationContext,
  n = 5,
): { wins: Mover[]; losses: Mover[] } {
  const movers: Mover[] = holdings
    .filter((h) => h.position.shares > 0 || h.realizedPL !== 0)
    .map((h) => {
      const { abs, pct } = holdingPeriodProfit(h.asset, txs, tf, v);
      return {
        id: h.asset.id,
        name: h.asset.name,
        symbol: h.asset.symbol,
        pl: abs,
        plPercent: pct,
      };
    });
  const wins = movers.filter((m) => m.pl > 0).sort((a, b) => b.pl - a.pl).slice(0, n);
  const losses = movers.filter((m) => m.pl < 0).sort((a, b) => a.pl - b.pl).slice(0, n);
  return { wins, losses };
}

/** "2025-01" → "Jan '25". */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const mon = new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(y, m - 1, 1));
  return `${mon} '${String(y).slice(2)}`;
}

/** Fill every month between the first and last sell so the axis is continuous. */
function fillMonths(rows: MonthlyRealized[]): MonthlyRealized[] {
  if (rows.length === 0) return [];
  const have = new Map(rows.map((r) => [r.month, r.realized]));
  const out: MonthlyRealized[] = [];
  let [y, m] = rows[0].month.split("-").map(Number);
  const last = rows[rows.length - 1].month;
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: key, realized: have.get(key) ?? 0 });
    if (key === last) break;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function TradesView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const { t } = useI18n();
  const currency = data.profile.currency;

  const [moversTf, setMoversTf] = useState<Timeframe>("MAX");

  const holdings = useMemo(
    () => summarizeAll(data.assets, data.transactions, valuation),
    [data.assets, data.transactions, valuation],
  );

  const totals = useMemo(() => portfolioTotals(holdings), [holdings]);

  const histItems = useMemo(
    () =>
      data.assets
        .map(quoteItemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const divMap = useDividends(histItems);
  const dividendsReceived = useMemo(() => {
    const fx = valuation.fx ?? {};
    let total = 0;
    for (const asset of data.assets) {
      const events = divMap[assetPriceKey(asset)];
      if (!events || events.length === 0) continue;
      const txs = transactionsByAsset(asset.id, data.transactions);
      const received = totalDividends(dividendsFromEvents(events, txs));
      const cur = asset.currency ?? currency;
      total += received * (cur === currency ? 1 : (fx[cur] ?? 1));
    }
    return total;
  }, [divMap, data.assets, data.transactions, currency, valuation]);

  const monthly = useMemo(
    () => realizedByMonth(data.assets, data.transactions, valuation),
    [data.assets, data.transactions, valuation],
  );

  const { wins, losses } = useMemo(
    () =>
      moversTf === "MAX"
        ? topMovers(holdings)
        : windowedMovers(holdings, data.transactions, moversTf, valuation),
    [holdings, data.transactions, moversTf, valuation],
  );

  const barData = useMemo(
    () =>
      fillMonths(monthly).map((m) => ({
        label: monthLabel(m.month),
        value: m.realized,
      })),
    [monthly],
  );

  if (data.assets.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("trades.addHoldings")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <Stat
            label={t("stat.unrealized")}
            value={formatCurrency(totals.unrealizedPL, currency)}
            sub={formatPercent(totals.totalPLPercent)}
            valueClassName={plColor(totals.unrealizedPL)}
            info={t("tip.unrealized")}
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label={t("stat.realized")}
            value={formatCurrency(totals.realizedPL, currency)}
            valueClassName={plColor(totals.realizedPL)}
            info={t("tip.realized")}
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label={t("stat.dividends")}
            value={formatCurrency(dividendsReceived, currency)}
            valueClassName={dividendsReceived > 0 ? plColor(1) : ""}
            info={t("tip.dividends")}
            isPrivate
          />
        </Card>
      </div>

      <Card>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          {t("trades.byMonth")}
          <InfoTip text={t("trades.byMonthTip")} />
        </h2>
        {barData.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("trades.noSells")}</p>
        ) : (
          <div className="mt-3" data-private>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  minTickGap={16}
                  interval="preserveStartEnd"
                  stroke="currentColor"
                  className="text-zinc-400"
                />
                <YAxis
                  tickFormatter={(v) => formatCurrency(Number(v), currency)}
                  width={64}
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-zinc-400"
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid rgba(120,120,120,0.3)", fontSize: 13 }}
                  formatter={(v) => [formatCurrency(Number(v), currency), t("trades.realized")]}
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {barData.map((d, i) => (
                    <Cell key={i} fill={d.value >= 0 ? EMERALD : RED} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("trades.topMoversTitle")}</h2>
          <SegmentedControl
            size="sm"
            value={moversTf}
            onChange={setMoversTf}
            options={TF_OPTIONS.map((opt) => ({ label: opt, value: opt }))}
          />
        </div>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <MoverList title={t("trades.topWinners")} movers={wins} currency={currency} positive />
          <MoverList title={t("trades.topLosers")} movers={losses} currency={currency} positive={false} />
        </div>
      </div>
    </div>
  );
}

function MoverList({
  title,
  movers,
  currency,
  positive,
}: {
  title: string;
  movers: Mover[];
  currency: string;
  positive: boolean;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {title}
        <InfoTip text={t("trades.moverTip")} />
      </h3>
      {movers.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("trades.nothing")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {movers.map((m) => (
            <li key={m.id}>
              <Link
                href={`/assets/${m.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {m.name}
                  {m.symbol && <span className="ml-1 font-mono text-xs text-zinc-500">{m.symbol}</span>}
                </span>
                <span className={`shrink-0 text-right text-sm tabular-nums ${plColor(positive ? 1 : -1)}`}>
                  <span data-private>{formatCurrency(m.pl, currency)}</span>
                  <span className="ml-1 text-xs opacity-80">{formatPercent(m.plPercent)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
