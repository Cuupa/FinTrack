"use client";

// Risk tab: portfolio-level risk metrics (Sharpe, Sortino, volatility, beta,
// alpha, max drawdown, VaR) shown as gauges, a per-asset risk table, and a
// correlation heatmap. All figures are measured from real history where
// available (synthetic fallback), over the selected timeframe.

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
import { BENCHMARKS } from "@/lib/finance/benchmarks";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import { formatNumber, formatPercent, plColor } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { useI18n } from "@/lib/i18n/i18n-context";

const RF = 0.02; // risk-free rate used for Sharpe/Sortino/alpha
const TF_OPTIONS: Timeframe[] = ["1Y", "5Y", "10Y", "MAX"];

export function RiskView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const { t } = useI18n();
  const base = data.profile.currency;

  const [tf, setTf] = useState<Timeframe>("1Y");
  const [benchId, setBenchId] = useState<string>(BENCHMARKS[0].id);

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
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

  const benchCompare = useBenchmarkCompare([benchId], base);
  const benchPoints = useMemo(() => benchCompare[0]?.points ?? [], [benchCompare]);

  // Portfolio cumulative return series over the window → risk metrics.
  const returnSeries = useMemo(
    () => twrSeries(data.assets, data.transactions, tf, valuation, histories),
    [data.assets, data.transactions, tf, valuation, histories],
  );
  const risk = useMemo(() => riskMetrics(returnSeries), [returnSeries]);

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
    // Parametric 1-month VaR at 95% (normal): expected worst monthly loss.
    const monthlyVol = risk.volatility / Math.sqrt(12);
    const var95 = Math.max(0, 1.645 * monthlyVol - annReturn / 12);
    const levels = returnSeries.map((p) => ({ date: p.date, value: 1 + p.value }));
    const ba = betaAlpha(levels, benchPoints, RF);
    return { annReturn, sharpe, sortino, var95, beta: ba?.beta ?? null, alpha: ba?.alpha ?? null };
  }, [returnSeries, risk, benchPoints]);

  // Per-asset risk table.
  const assetRows = useMemo(() => {
    return holdings
      .map((h) => {
        const ann = assetAnnualStats(h.asset, histories, 5);
        const key = assetPriceKey(h.asset);
        const hist = histories[key];
        const levels = hist ? hist.map((p) => ({ date: p.date, value: p.close })) : [];
        const ba = levels.length >= 3 ? betaAlpha(levels, benchPoints, RF) : null;
        return {
          id: h.asset.id,
          name: h.asset.name,
          symbol: h.asset.symbol,
          vol: ann.vol,
          sharpe: ann.sharpe,
          beta: ba?.beta ?? null,
          weight: total > 0 ? h.marketValue / total : 0,
        };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [holdings, histories, benchPoints, total]);

  // Correlation matrix (value-weighted holdings, real monthly returns).
  const model = useMemo(
    () =>
      estimatePortfolioModel(
        holdings.map((h) => ({ asset: h.asset, marketValue: h.marketValue })),
        5,
        histories,
      ),
    [holdings, histories],
  );

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("risk.addHoldings")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            {t("risk.portfolioTitle")}
            <InfoTip text={t("risk.portfolioTip")} />
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={benchId}
              onChange={(e) => setBenchId(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              aria-label={t("risk.benchmark")}
            >
              {BENCHMARKS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
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

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <GaugeStat
            label={t("risk.sharpe")}
            info={t("risk.sharpeTip")}
            value={portfolio.sharpe}
            min={-1}
            max={3}
            goodHigh
            format={(v) => formatNumber(v, 2)}
          />
          <GaugeStat
            label={t("risk.sortino")}
            info={t("risk.sortinoTip")}
            value={portfolio.sortino}
            min={-1}
            max={3}
            goodHigh
            format={(v) => formatNumber(v, 2)}
          />
          <GaugeStat
            label={t("risk.volatility")}
            info={t("risk.volatilityTip")}
            value={risk.volatility}
            min={0}
            max={0.4}
            goodHigh={false}
            format={(v) => formatPercent(v, 1)}
          />
          <GaugeStat
            label={t("risk.beta")}
            info={t("risk.betaTip")}
            value={portfolio.beta}
            min={0}
            max={2}
            neutral={1}
            format={(v) => formatNumber(v, 2)}
          />
          <GaugeStat
            label={t("risk.alpha")}
            info={t("risk.alphaTip")}
            value={portfolio.alpha}
            min={-0.1}
            max={0.1}
            goodHigh
            format={(v) => formatPercent(v, 1)}
          />
          <GaugeStat
            label={t("risk.maxDrawdown")}
            info={t("risk.maxDrawdownTip")}
            value={risk.maxDrawdown}
            min={0}
            max={0.6}
            goodHigh={false}
            format={(v) => formatPercent(v, 1)}
            sub={`${risk.maxDrawdownDays} ${t("risk.days")}`}
          />
          <GaugeStat
            label={t("risk.var")}
            info={t("risk.varTip")}
            value={portfolio.var95}
            min={0}
            max={0.3}
            goodHigh={false}
            format={(v) => formatPercent(v, 1)}
          />
        </div>
      </Card>

      {/* Per-asset risk table */}
      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t("risk.byAsset")}
          <InfoTip text={t("risk.byAssetTip")} />
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3 font-medium">{t("risk.asset")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("risk.volatility")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("risk.beta")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("risk.sharpe")}</th>
                <th className="py-2 text-right font-medium">{t("risk.weight")}</th>
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

// --- Gauge -------------------------------------------------------------------

/** Quality (0 bad … 1 good) for colouring, given the desired direction. */
function quality(frac: number, goodHigh?: boolean, neutral?: number): number {
  if (neutral != null) return 1 - Math.min(1, Math.abs(frac - neutral) / Math.max(neutral, 1 - neutral));
  return goodHigh ? frac : 1 - frac;
}

function qualityColor(q: number): string {
  if (q >= 0.66) return "#10b981";
  if (q >= 0.33) return "#f59e0b";
  return "#ef4444";
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

function GaugeStat({
  label,
  info,
  value,
  min,
  max,
  goodHigh,
  neutral,
  format,
  sub,
}: {
  label: string;
  info: string;
  value: number | null;
  min: number;
  max: number;
  goodHigh?: boolean;
  neutral?: number;
  format: (v: number) => string;
  sub?: string;
}) {
  const has = value != null && Number.isFinite(value);
  const frac = has ? Math.min(1, Math.max(0, ((value as number) - min) / (max - min))) : 0;
  const neutralFrac = neutral != null ? (neutral - min) / (max - min) : undefined;
  const q = quality(frac, goodHigh, neutralFrac);
  const color = has ? qualityColor(q) : "#a1a1aa";
  // 180° arc, left (180°) → right (0°).
  const angle = 180 - 180 * frac;
  const [nx, ny] = polar(50, 50, 34, angle);
  const [vx, vy] = polar(50, 50, 40, angle);

  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center gap-1 text-xs leading-snug text-zinc-500">
        <span>{label}</span>
        <InfoTip text={info} />
      </div>
      <svg viewBox="0 0 100 58" className="mt-1 w-full max-w-[120px]">
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="currentColor" className="text-zinc-200 dark:text-zinc-700" strokeWidth={7} strokeLinecap="round" />
        {has && (
          <path
            d={`M 10 50 A 40 40 0 0 1 ${vx.toFixed(2)} ${vy.toFixed(2)}`}
            fill="none"
            stroke={color}
            strokeWidth={7}
            strokeLinecap="round"
          />
        )}
        {has && <line x1={50} y1={50} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke={color} strokeWidth={2} />}
        <circle cx={50} cy={50} r={2.5} fill={color} />
      </svg>
      <div className="-mt-1 text-base font-semibold tabular-nums" style={{ color }}>
        {has ? format(value as number) : "—"}
      </div>
      {sub && <div className="text-[11px] text-zinc-400 tabular-nums">{sub}</div>}
    </div>
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
