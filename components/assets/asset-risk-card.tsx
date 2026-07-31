"use client";

// Risk metrics for ONE instrument (flag `risk`). The portfolio-level tab
// answers "how risky is my portfolio"; this answers the same question for the
// position in front of you, and it does so with the same numbers: volatility
// and Sharpe from `assetAnnualStats`, drawdown/downside from `riskMetrics`,
// beta/alpha against the MSCI World from `betaAlpha` -- the exact functions the
// risk tab uses, rendered with the exact same `MetricCard`.
//
// Everything is measured from this instrument's own price history in the base
// currency. Too short a history is reported as "—" per metric rather than as a
// confident-looking number computed from three points.

import { useMemo } from "react";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { assetPriceKey, type Asset } from "@/lib/types";
import type { HistoryMap } from "@/lib/history/history";
import { betaAlpha, riskMetrics } from "@/lib/finance/returns";
import { assetAnnualStats } from "@/lib/finance/stats";
import { formatNumber, formatPercent } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { MetricCard } from "@/components/analysis/metric-card";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import { useI18n } from "@/lib/i18n/i18n-context";

const RF = 0.02; // same risk-free rate the risk tab uses
const MSCI_WORLD = ["msci-world"];
/** Below this many history points nothing is measured, only guessed. */
const MIN_POINTS = 3;

export function AssetRiskCard({ asset, histories }: { asset: Asset; histories: HistoryMap }) {
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = valuation.base;

  // This instrument's price history, normalised into the base currency -- the
  // same shape the risk tab feeds betaAlpha.
  const levels = useMemo(() => {
    const hist = histories[assetPriceKey(asset)];
    if (!hist) return [];
    const cur = asset.currency ?? base;
    const rate = cur === base ? 1 : (valuation.fx?.[cur] ?? 1);
    return hist.map((p) => ({ date: p.date, value: p.close * rate }));
  }, [asset, histories, valuation.fx, base]);

  const annual = useMemo(() => assetAnnualStats(asset, histories, 100), [asset, histories]);

  // Drawdown and downside want a cumulative-RETURN series, not price levels.
  const risk = useMemo(() => {
    if (levels.length < MIN_POINTS || levels[0].value <= 0) return null;
    const first = levels[0].value;
    return riskMetrics(levels.map((p) => ({ date: p.date, value: p.value / first - 1 })));
  }, [levels]);

  const compare = useBenchmarkCompare(MSCI_WORLD, base);
  const benchLevels = useMemo(() => (compare[0]?.points ?? []).filter((p) => p.value > 0), [compare]);
  const ba = useMemo(
    () =>
      levels.length >= MIN_POINTS && benchLevels.length >= MIN_POINTS
        ? betaAlpha(levels, benchLevels, RF)
        : null,
    [levels, benchLevels],
  );

  // Monthly 95% VaR, same estimator as the portfolio tile: 1.645 sigma minus
  // the month's expected drift.
  const var95 =
    annual.vol > 0 ? Math.max(0, 1.645 * (annual.vol / Math.sqrt(12)) - annual.mean / 12) : null;
  const sortino =
    risk && risk.downsideDeviation > 0 ? (annual.mean - RF) / risk.downsideDeviation : null;

  // Nothing measurable at all (no history, no synthetic series either).
  if (annual.vol <= 0 && levels.length < MIN_POINTS) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("asset.risk.title")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("asset.risk.intro")}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard
          label={t("risk.volatility")}
          info={t("risk.volatilityTip")}
          value={annual.vol > 0 ? annual.vol : null}
          min={0}
          max={0.4}
          good={0.15}
          ok={0.25}
          higherIsBetter={false}
          format={(v) => formatPercent(v, 1)}
        />
        <MetricCard
          label={t("risk.sharpe")}
          info={t("risk.sharpeTip")}
          value={annual.sharpe}
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
          value={sortino}
          min={-1}
          max={3}
          good={1}
          ok={0}
          higherIsBetter
          format={(v) => formatNumber(v, 2)}
        />
        <MetricCard
          label={t("risk.beta")}
          info={t("risk.betaTip")}
          value={ba?.beta ?? null}
          min={0}
          max={2}
          neutral
          reference={1}
          format={(v) => formatNumber(v, 2)}
        />
        <MetricCard
          label={t("risk.alpha")}
          info={t("risk.alphaTip")}
          value={ba?.alpha ?? null}
          min={-0.1}
          max={0.1}
          good={0.02}
          ok={0}
          higherIsBetter
          format={(v) => formatPercent(v, 1)}
        />
        {/* Drawdown and VaR are losses: shown negative, closer to zero is better. */}
        <MetricCard
          label={t("risk.maxDrawdown")}
          info={t("risk.maxDrawdownTip")}
          value={risk ? -risk.maxDrawdown : null}
          min={-0.6}
          max={0}
          good={-0.15}
          ok={-0.3}
          higherIsBetter
          format={(v) => formatPercent(v, 1)}
          sub={risk ? `${risk.maxDrawdownDays} ${t("risk.days")}` : undefined}
        />
        <MetricCard
          label={t("risk.var")}
          info={t("risk.varTip")}
          value={var95 != null ? -var95 : null}
          min={-0.3}
          max={0}
          good={-0.05}
          ok={-0.1}
          higherIsBetter
          format={(v) => formatPercent(v, 1)}
        />
      </div>
      {!annual.real && <p className="mt-3 text-xs text-zinc-500">{t("asset.risk.synthetic")}</p>}
    </Card>
  );
}
