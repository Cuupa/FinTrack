"use client";

// Trades tab: realised P&L per month and the best/worst holdings by total P&L.

import { useMemo } from "react";
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
import { summarizeAll } from "@/lib/finance/portfolio";
import { realizedByMonth, topMovers, type Mover, type MonthlyRealized } from "@/lib/finance/trades";
import { formatCurrency, formatPercent, plColor } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { useI18n } from "@/lib/i18n/i18n-context";

const EMERALD = "#10b981";
const RED = "#ef4444";

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
  const { t } = useI18n();
  const currency = data.profile.currency;

  const holdings = useMemo(
    () => summarizeAll(data.assets, data.transactions, valuation),
    [data.assets, data.transactions, valuation],
  );

  const monthly = useMemo(
    () => realizedByMonth(data.assets, data.transactions, valuation),
    [data.assets, data.transactions, valuation],
  );

  const { wins, losses } = useMemo(() => topMovers(holdings), [holdings]);

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

      <div className="grid gap-6 md:grid-cols-2">
        <MoverList title={t("trades.topWinners")} movers={wins} currency={currency} positive />
        <MoverList title={t("trades.topLosers")} movers={losses} currency={currency} positive={false} />
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
