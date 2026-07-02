"use client";

// Risk tab: portfolio-level risk metrics shown as modern metric cards (Sharpe,
// Sortino, volatility, max drawdown, VaR), a sortable per-asset risk table
// (including each holding's beta/alpha RELATIVE TO YOUR OWN PORTFOLIO — no
// external benchmark), and a correlation heatmap. The primary control scopes
// everything to a selection of your own positions. Figures are measured from
// real history where available (synthetic fallback).

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll, twrSeries } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { betaAlpha, riskMetrics } from "@/lib/finance/returns";
import { assetAnnualStats, estimatePortfolioModel } from "@/lib/finance/stats";
import { assetPriceKey } from "@/lib/types";
import type { Timeframe } from "@/lib/finance/dates";
import { ScopeSelect } from "@/components/analysis/scope-select";
import { formatNumber, formatPercent, plColor } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { useI18n } from "@/lib/i18n/i18n-context";

const RF = 0.02; // risk-free rate used for Sharpe/Sortino/alpha
const TF_OPTIONS: Timeframe[] = ["1Y", "5Y", "10Y", "MAX"];

type SortKey = "name" | "vol" | "beta" | "alpha" | "sharpe" | "weight";

export function RiskView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const { t } = useI18n();
  const base = data.profile.currency;

  const [tf, setTf] = useState<Timeframe>("1Y");
  const [scope, setScope] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "weight", dir: -1 });

  const allHoldings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  const scopeOptions = useMemo(
    () => allHoldings.map((h) => ({ id: h.asset.id, label: h.asset.name })),
    [allHoldings],
  );

  // Everything below is scoped to the selected own positions ([] = all).
  const inScope = (id: string) => scope.length === 0 || scope.includes(id);
  const holdings = useMemo(
    () => allHoldings.filter((h) => inScope(h.asset.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allHoldings, scope],
  );
  const scopedAssets = useMemo(
    () => data.assets.filter((a) => inScope(a.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, scope],
  );
  const scopedTxs = useMemo(
    () => data.transactions.filter((tx) => inScope(tx.assetId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.transactions, scope],
  );
  const total = useMemo(() => holdings.reduce((s, h) => s + h.marketValue, 0), [holdings]);

  const histItems = useMemo(
    () =>
      data.assets
        .map(quoteItemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories } = useHistory(histItems, tf, base);

  const returnSeries = useMemo(
    () => twrSeries(scopedAssets, scopedTxs, tf, valuation, histories),
    [scopedAssets, scopedTxs, tf, valuation, histories],
  );
  const risk = useMemo(() => riskMetrics(returnSeries), [returnSeries]);

  // The portfolio's own return path is the reference "market" for the per-asset
  // beta/alpha — an intrinsic measure of each holding vs the whole portfolio,
  // with no external index involved.
  const portLevels = useMemo(
    () => returnSeries.map((p) => ({ date: p.date, value: 1 + p.value })),
    [returnSeries],
  );

  const portfolio = useMemo(() => {
    const n = returnSeries.length;
    const years =
      n > 1
        ? Math.max(
            1 / 365,
            (Date.parse(returnSeries[n - 1].date) - Date.parse(returnSeries[0].date)) /
              (365 * 86_400_000),
          )
        : 1;
    const annReturn = n > 1 && years > 0 ? (1 + risk.twr) ** (1 / years) - 1 : risk.twr;
    const sharpe = risk.volatility > 0 ? (annReturn - RF) / risk.volatility : null;
    const sortino =
      risk.downsideDeviation > 0 ? (annReturn - RF) / risk.downsideDeviation : null;
    const monthlyVol = risk.volatility / Math.sqrt(12);
    const var95 = Math.max(0, 1.645 * monthlyVol - annReturn / 12);
    return { annReturn, sharpe, sortino, var95 };
  }, [returnSeries, risk]);

  const assetRows = useMemo(() => {
    const fx = valuation.fx ?? {};
    const rows = holdings.map((h) => {
      const ann = assetAnnualStats(h.asset, histories, 5);
      const key = assetPriceKey(h.asset);
      const hist = histories[key];
      // Normalise the asset's price history into the BASE currency, then measure
      // its beta/alpha against the portfolio's own return path (not an index).
      const cur = h.asset.currency ?? base;
      const rate = cur === base ? 1 : (fx[cur] ?? 1);
      const levels = hist ? hist.map((p) => ({ date: p.date, value: p.close * rate })) : [];
      const ba = levels.length >= 3 && portLevels.length >= 3 ? betaAlpha(levels, portLevels, RF) : null;
      return {
        id: h.asset.id,
        name: h.asset.name,
        symbol: h.asset.symbol,
        vol: ann.vol,
        sharpe: ann.sharpe,
        beta: ba?.beta ?? null,
        alpha: ba?.alpha ?? null,
        weight: total > 0 ? h.marketValue / total : 0,
      };
    });
    const val = (r: (typeof rows)[number], k: SortKey): number | string =>
      k === "name" ? r.name.toLowerCase() : (r[k] ?? -Infinity);
    return rows.sort((a, b) => {
      const va = val(a, sort.key);
      const vb = val(b, sort.key);
      if (va < vb) return -1 * sort.dir;
      if (va > vb) return 1 * sort.dir;
      return 0;
    });
  }, [holdings, histories, portLevels, total, sort, valuation, base]);

  const model = useMemo(
    () =>
      estimatePortfolioModel(
        holdings.map((h) => ({ asset: h.asset, marketValue: h.marketValue })),
        5,
        histories,
      ),
    [holdings, histories],
  );

  if (allHoldings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("risk.addHoldings")}</p>
      </Card>
    );
  }

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" ? 1 : -1 }));

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            {t("risk.portfolioTitle")}
            <InfoTip text={t("risk.portfolioTip")} />
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <ScopeSelect options={scopeOptions} selected={scope} onChange={setScope} />
            <div className="inline-flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
              {TF_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setTf(opt)}
                  aria-pressed={tf === opt}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    tf === opt
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            label={t("risk.sharpe")}
            info={t("risk.sharpeTip")}
            value={portfolio.sharpe}
            min={-1}
            max={3}
            good={1}
            ok={0}
            higherIsBetter
            format={(v) => formatNumber(v, 2)}
          />
          <MetricCard
            label={t("risk.sortino")}
            info={t("risk.sortinoTip")}
            value={portfolio.sortino}
            min={-1}
            max={3}
            good={1}
            ok={0}
            higherIsBetter
            format={(v) => formatNumber(v, 2)}
          />
          <MetricCard
            label={t("risk.volatility")}
            info={t("risk.volatilityTip")}
            value={risk.volatility}
            min={0}
            max={0.4}
            good={0.15}
            ok={0.25}
            higherIsBetter={false}
            format={(v) => formatPercent(v, 1)}
          />
          {/* Drawdown & VaR are losses — shown as NEGATIVE percentages. Closer to
              zero is better, so higherIsBetter with negative thresholds. */}
          <MetricCard
            label={t("risk.maxDrawdown")}
            info={t("risk.maxDrawdownTip")}
            value={-risk.maxDrawdown}
            min={-0.6}
            max={0}
            good={-0.15}
            ok={-0.3}
            higherIsBetter
            format={(v) => formatPercent(v, 1)}
            sub={`${risk.maxDrawdownDays} ${t("risk.days")}`}
          />
          <MetricCard
            label={t("risk.var")}
            info={t("risk.varTip")}
            value={-portfolio.var95}
            min={-0.3}
            max={0}
            good={-0.05}
            ok={-0.1}
            higherIsBetter
            format={(v) => formatPercent(v, 1)}
          />
        </div>
      </Card>

      {/* Per-asset risk table (sortable) */}
      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t("risk.byAsset")}
          <InfoTip text={t("risk.byAssetTip")} />
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <RiskTh label={t("risk.asset")} k="name" sort={sort} onSort={toggleSort} />
                <RiskTh label={t("risk.volatility")} k="vol" align="right" sort={sort} onSort={toggleSort} />
                <RiskTh label={t("risk.beta")} k="beta" align="right" sort={sort} onSort={toggleSort} />
                <RiskTh label={t("risk.alpha")} k="alpha" align="right" sort={sort} onSort={toggleSort} />
                <RiskTh label={t("risk.sharpe")} k="sharpe" align="right" sort={sort} onSort={toggleSort} />
                <RiskTh label={t("risk.weight")} k="weight" align="right" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {assetRows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                >
                  <td className="py-2 pr-3">
                    <Link href={`/assets/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    {r.symbol && (
                      <span className="ml-1 font-mono text-xs text-zinc-500">{r.symbol}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.vol > 0 ? formatPercent(r.vol, 1) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.beta != null ? formatNumber(r.beta, 2) : "—"}
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${r.alpha != null ? plColor(r.alpha) : ""}`}>
                    {r.alpha != null ? formatPercent(r.alpha, 1) : "—"}
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${r.sharpe != null ? plColor(r.sharpe) : ""}`}>
                    {r.sharpe != null ? formatNumber(r.sharpe, 2) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {formatPercent(r.weight, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Correlation heatmap */}
      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t("risk.correlation")}
          <InfoTip text={t("risk.correlationTip")} />
        </h3>
        {!model || model.assets.length < 2 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("risk.correlationNeed")}</p>
        ) : (
          <CorrelationMatrix labels={model.assets.map((a) => a.name)} corr={model.corr} />
        )}
      </Card>
    </div>
  );
}

// --- Metric card -------------------------------------------------------------

const RED = "#ef4444";
const AMBER = "#f59e0b";
const GREEN = "#10b981";

/**
 * Quality tier (0 poor · 1 moderate · 2 good) from the value vs the metric's
 * REAL thresholds — not its position in [min,max]. This is why a Sharpe of 1.12
 * reads green ("good") even though it sits mid-range on a −1…3 axis.
 */
function tier(value: number, good: number, ok: number, higherIsBetter: boolean): 0 | 1 | 2 {
  if (higherIsBetter) return value >= good ? 2 : value >= ok ? 1 : 0;
  return value <= good ? 2 : value <= ok ? 1 : 0;
}

const TIER_COLOR = [RED, AMBER, GREEN];

function MetricCard({
  label,
  info,
  value,
  min,
  max,
  good,
  ok,
  higherIsBetter,
  format,
  sub,
}: {
  label: string;
  info: string;
  value: number | null;
  min: number;
  max: number;
  /** Value at/beyond which the metric is "good" (green). */
  good: number;
  /** Value at/beyond which it is "moderate" (amber); worse than this is poor. */
  ok: number;
  higherIsBetter: boolean;
  format: (v: number) => string;
  sub?: string;
}) {
  const { t } = useI18n();
  const has = value != null && Number.isFinite(value);
  const frac = has ? Math.min(1, Math.max(0, ((value as number) - min) / (max - min))) : 0;
  const q = has ? tier(value as number, good, ok, higherIsBetter) : 0;
  const color = has ? TIER_COLOR[q] : "#a1a1aa";
  const word = !has ? "" : q === 2 ? t("risk.qGood") : q === 1 ? t("risk.qModerate") : t("risk.qPoor");

  // Track: a poor→good landscape oriented by the metric's direction; the thumb
  // marks where the value sits.
  const gradient = higherIsBetter
    ? `linear-gradient(to right, ${RED}, ${AMBER}, ${GREEN})`
    : `linear-gradient(to right, ${GREEN}, ${AMBER}, ${RED})`;

  return (
    <div
      title={`${label} — ${info}`}
      className="group rounded-xl border border-zinc-200/70 bg-white p-3.5 transition-shadow hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      <div className="flex items-center gap-1 text-xs font-medium text-zinc-500">
        <span className="truncate">{label}</span>
        <InfoTip text={info} />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-1.5">
        <span className="text-2xl font-semibold tabular-nums" style={{ color }}>
          {has ? format(value as number) : "—"}
        </span>
        {word && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color, backgroundColor: `${color}1f` }}
          >
            {word}
          </span>
        )}
      </div>
      {/* bullet gauge: zone track + thumb at the value */}
      <div className="relative mt-3 h-2 w-full rounded-full" style={{ background: gradient, opacity: has ? 0.85 : 0.2 }}>
        {has && (
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow ring-1 ring-black/10 dark:border-zinc-900"
            style={{ left: `${frac * 100}%`, backgroundColor: color }}
          />
        )}
      </div>
      {sub && <div className="mt-1.5 text-[10px] text-zinc-400 tabular-nums">{sub}</div>}
    </div>
  );
}

function RiskTh({
  label,
  k,
  align = "left",
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  align?: "left" | "right";
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className={`py-2 pr-3 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        <span className="text-[10px]">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

// --- Correlation heatmap -----------------------------------------------------

function corrColor(c: number): string {
  // +1 → red (move together), 0 → neutral, −1 → blue (hedge).
  if (c >= 0) return `rgba(239,68,68,${0.12 + 0.6 * c})`;
  return `rgba(59,130,246,${0.12 + 0.6 * -c})`;
}

function shortLabel(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}

function CorrelationMatrix({ labels, corr }: { labels: string[]; corr: number[][] }) {
  const n = labels.length;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {labels.map((l, i) => (
              <th key={i} className="px-1 pb-1 text-[10px] font-medium text-zinc-500" title={l}>
                <div className="mx-auto w-10 truncate">{shortLabel(l)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-right text-[10px] font-medium text-zinc-500" title={row}>
                <div className="w-20 truncate">{shortLabel(row)}</div>
              </td>
              {Array.from({ length: n }, (_, j) => (
                <td
                  key={j}
                  className="h-10 w-10 rounded text-center text-[10px] tabular-nums text-zinc-700 dark:text-zinc-200"
                  style={{ backgroundColor: corrColor(corr[i][j]) }}
                  title={`${row} ↔ ${labels[j]}: ${corr[i][j].toFixed(2)}`}
                >
                  {corr[i][j].toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
