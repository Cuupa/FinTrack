"use client";

// Risk tab: portfolio-level risk metrics shown as modern metric cards (Sharpe,
// Sortino, volatility, portfolio beta/alpha, max drawdown, VaR), a sortable
// per-asset risk table (including each holding's beta/alpha vs. the MSCI
// World benchmark), and a correlation heatmap. The primary control scopes
// everything to a selection of your own positions. Figures are measured from
// real history where available (synthetic fallback), and the KPI tiles and
// the per-asset table share one computation basis (portfolioRiskStats /
// assetAnnualStats) so they never disagree.

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { summarizeAll, twrSeries } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { betaAlpha, compositeLevelSeries, riskMetrics } from "@/lib/finance/returns";
import { assetAnnualStats, estimatePortfolioModel, portfolioRiskStats } from "@/lib/finance/stats";
import { assetPriceKey } from "@/lib/types";
import type { Timeframe } from "@/lib/finance/dates";
import { ScopeSelect } from "@/components/analysis/scope-select";
import { MetricCard } from "@/components/analysis/metric-card";
import { formatNumber, formatPercent, plColor } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { type SortState } from "@/lib/tables/sort";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import { RiskTour, TourReplayButton } from "@/components/onboarding/page-tours";

const RF = 0.02; // risk-free rate used for Sharpe/Sortino/alpha
const TF_OPTIONS: Timeframe[] = ["1Y", "5Y", "10Y", "MAX"];
// This tab only offers the four timeframes above (not the full Timeframe
// union), so the lookback/horizon years map is keyed by that narrower set —
// `tf`'s declared type is the wider `Timeframe` (shared with the rest of the
// app), so we cast at the lookup site below.
type RiskTimeframe = "1Y" | "5Y" | "10Y" | "MAX";
const YEARS_FOR_TF: Record<RiskTimeframe, number> = { "1Y": 1, "5Y": 5, "10Y": 10, MAX: 100 };
const MSCI_WORLD = ["msci-world"];

type SortKey = "name" | "vol" | "beta" | "alpha" | "sharpe" | "weight";

/**
 * Sharpe cell coloring: only a strong risk-adjusted return (>= 1) reads as
 * "good" (emerald); a merely positive-but-mediocre Sharpe (0..1) stays the
 * default ink instead of overstating it as green, and negative is red.
 */
function sharpeColor(value: number): string {
  if (value >= 1) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-zinc-500";
}

export function RiskView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const { t } = useI18n();
  const base = data.profile.currency;

  const [tf, setTf] = useState<Timeframe>("1Y");
  const [scope, setScope] = useState<string[]>([]);
  const { sort, toggle: toggleSort, apply: applySort } = useSort<SortKey>("weight", "desc");
  const [tourReplay, setTourReplay] = useState(0);
  const years = YEARS_FOR_TF[tf as RiskTimeframe];

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
  const { histories, fx } = useHistory(histItems, tf, base);

  // Layers the fetched historical FX series onto the live valuation so
  // twrSeries (the risk.twr KPI) converts each historical point at the FX
  // rate of ITS OWN date instead of today's spot rate (rateOn in
  // portfolio.ts). Referentially equal to `valuation` when there's no fx yet.
  const effectiveValuation = useMemo(() => {
    if (!fx || Object.keys(fx).length === 0) return valuation;
    return { ...valuation, fxHistory: fx };
  }, [valuation, fx]);

  const returnSeries = useMemo(
    () => twrSeries(scopedAssets, scopedTxs, tf, effectiveValuation, histories),
    [scopedAssets, scopedTxs, tf, effectiveValuation, histories],
  );
  // twrSeries emits a flat 0-value prefix for every day before the scoped
  // holding(s) had any shares (periods with zero shares are skipped, so `cum`
  // never moves off 1). Feeding those fake flat days into riskMetrics dilutes
  // volatility/downside/drawdown, and annualising the accrued TWR over that
  // padded span (instead of the actual exposure span) understates the return
  // — for a young, short-history holding this can even flip Sharpe negative.
  // Trim the prefix, keeping one leading zero point as the baseline, so KPI
  // metrics and their annualisation window cover only the period the scoped
  // holding(s) were actually held.
  const metricsSeries = useMemo(() => {
    const i = returnSeries.findIndex((p) => p.value !== 0);
    return i > 0 ? returnSeries.slice(i - 1) : returnSeries;
  }, [returnSeries]);
  const risk = useMemo(() => riskMetrics(metricsSeries), [metricsSeries]);

  // External benchmark for beta/alpha (both the portfolio-level KPI tiles and
  // the per-asset table): the same overlay mechanism the performance chart
  // uses, pinned to MSCI World and priced in the user's base currency.
  const compare = useBenchmarkCompare(MSCI_WORLD, base);
  const benchLevels = useMemo(
    () => (compare[0]?.points ?? []).filter((p) => p.value > 0),
    [compare],
  );

  // Unified computation basis: the KPI tiles and the risk-by-holding table
  // both derive from portfolioRiskStats/assetAnnualStats — the same per-asset
  // return series + measured correlations `estimatePortfolioModel` uses —
  // instead of the old separate TWR-based path.
  const pr = useMemo(
    () =>
      portfolioRiskStats(
        holdings.map((h) => ({ asset: h.asset, marketValue: h.marketValue })),
        years,
        histories,
        RF,
      ),
    [holdings, years, histories],
  );
  const var95 = pr
    ? Math.max(0, 1.645 * (pr.volatility / Math.sqrt(12)) - pr.annualReturn / 12)
    : null;

  // Per-asset price history normalised into the BASE currency — the SAME
  // level series the table's per-asset betaAlpha uses. Shared between the
  // table and the portfolio-level composite below so the KPI tiles and the
  // table rows measure beta/alpha on one basis (parity with the Sharpe tiles).
  const assetLevels = useMemo(() => {
    const fx = valuation.fx ?? {};
    return holdings.map((h) => {
      const key = assetPriceKey(h.asset);
      const hist = histories[key];
      const cur = h.asset.currency ?? base;
      const rate = cur === base ? 1 : (fx[cur] ?? 1);
      const levels = hist ? hist.map((p) => ({ date: p.date, value: p.close * rate })) : [];
      return { id: h.asset.id, levels, marketValue: h.marketValue };
    });
  }, [holdings, histories, valuation, base]);

  // Portfolio-level composite: each scoped asset's own levels, value-weighted
  // (same weights portfolioRiskStats uses) — not the exposure-trimmed TWR
  // path, so a single-holding scope is bit-identical to that holding's row.
  const compositeLevels = useMemo(
    () => compositeLevelSeries(assetLevels.map((a) => ({ levels: a.levels, weight: a.marketValue }))),
    [assetLevels],
  );
  const portBA =
    compositeLevels.length >= 3 && benchLevels.length >= 3
      ? betaAlpha(compositeLevels, benchLevels, RF)
      : null;

  const assetRows = useMemo(() => {
    const levelsById = new Map(assetLevels.map((a) => [a.id, a.levels]));
    const rows = holdings.map((h) => {
      const ann = assetAnnualStats(h.asset, histories, years);
      // Measure this asset's beta/alpha against the external MSCI World benchmark.
      const levels = levelsById.get(h.asset.id) ?? [];
      const ba = levels.length >= 3 && benchLevels.length >= 3 ? betaAlpha(levels, benchLevels, RF) : null;
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
    return applySort(rows, (r, key) => (key === "name" ? r.name : r[key]));
  }, [holdings, assetLevels, histories, years, benchLevels, total, applySort]);

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

  return (
    <div className="space-y-6">
      <RiskTour restartToken={tourReplay} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            {t("risk.portfolioTitle")}
            <InfoTip text={t("risk.portfolioTip")} />
            <TourReplayButton onClick={() => setTourReplay((n) => n + 1)} />
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div data-tour="risk-scope">
              <ScopeSelect options={scopeOptions} selected={scope} onChange={setScope} />
            </div>
            <div className="inline-flex flex-wrap gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
              {TF_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setTf(opt)}
                  aria-pressed={tf === opt}
                  className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
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
        <p className="mt-1.5 text-xs text-zinc-500">{t("risk.kpiScopeHint")}</p>

        <div data-tour="risk-kpis" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label={t("risk.sharpe")}
            info={t("risk.sharpeTip")}
            value={pr?.sharpe ?? null}
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
            value={pr?.sortino ?? null}
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
            value={pr?.volatility ?? null}
            min={0}
            max={0.4}
            good={0.15}
            ok={0.25}
            higherIsBetter={false}
            format={(v) => formatPercent(v, 1)}
          />
          <MetricCard
            label={t("risk.portfolioBeta")}
            info={t("risk.portfolioBetaTip")}
            value={portBA?.beta ?? null}
            min={0}
            max={2}
            neutral
            reference={1}
            format={(v) => formatNumber(v, 2)}
          />
          <MetricCard
            label={t("risk.portfolioAlpha")}
            info={t("risk.portfolioAlphaTip")}
            value={portBA?.alpha ?? null}
            min={-0.1}
            max={0.1}
            good={0.02}
            ok={0}
            higherIsBetter
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
            value={var95 != null ? -var95 : null}
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
        <Table className="mt-3" ariaLabel={t("risk.byAsset")}>
          <Thead>
            <Th sort={sort} sortKey="name" onSort={toggleSort}>
              {t("risk.asset")}
            </Th>
            <TipTh
              label={t("risk.volatility")}
              tip={t("risk.volatilityTip")}
              sortKey="vol"
              sort={sort}
              onSort={toggleSort}
            />
            <TipTh
              label={t("risk.beta")}
              suffix={t("risk.betaSuffix")}
              tip={t("risk.betaTip")}
              sortKey="beta"
              sort={sort}
              onSort={toggleSort}
            />
            <TipTh
              label={t("risk.alpha")}
              tip={t("risk.alphaTip")}
              sortKey="alpha"
              sort={sort}
              onSort={toggleSort}
            />
            <TipTh
              label={t("risk.sharpe")}
              tip={t("risk.sharpeTip")}
              sortKey="sharpe"
              sort={sort}
              onSort={toggleSort}
            />
            <TipTh
              label={t("risk.weight")}
              tip={t("risk.weightTip")}
              sortKey="weight"
              sort={sort}
              onSort={toggleSort}
            />
          </Thead>
          <Tbody>
            {assetRows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/assets/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.symbol && (
                    <span className="ml-1 font-mono text-xs text-zinc-500">{r.symbol}</span>
                  )}
                </Td>
                <Td align="right" className="tabular-nums">
                  {r.vol > 0 ? formatPercent(r.vol, 1) : "—"}
                </Td>
                <Td align="right" className="tabular-nums">
                  {r.beta != null ? formatNumber(r.beta, 2) : "—"}
                </Td>
                <Td align="right" className={`tabular-nums ${r.alpha != null ? plColor(r.alpha) : ""}`}>
                  {r.alpha != null ? formatPercent(r.alpha, 1) : "—"}
                </Td>
                <Td align="right" className={`tabular-nums ${r.sharpe != null ? sharpeColor(r.sharpe) : ""}`}>
                  {r.sharpe != null ? formatNumber(r.sharpe, 2) : "—"}
                </Td>
                <Td align="right" className="tabular-nums text-zinc-500">
                  {formatPercent(r.weight, 1)}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      {/* Correlation heatmap */}
      <Card data-tour="risk-correlation">
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


/**
 * A right-aligned, sortable column header with an explanatory (i) tip.
 * Built on top of the shared `Th` (for the shell's padding/alignment) but
 * NOT via its own sortable-button mode: `InfoTip` renders a real `<button>`,
 * and nesting that inside Th's sort `<button>` is invalid HTML that React
 * flags as a hydration error. The sort button and the tip button are
 * siblings here instead, right-aligned by the cell's own text-align.
 */
/** A right-aligned sortable header carrying an InfoTip. The tip is a <button>
 *  of its own, so it rides the shell's `after` slot as a SIBLING of the sort
 *  button; nesting the two would be invalid HTML React rejects at hydration. */
function TipTh({
  label,
  suffix,
  tip,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  /** Muted annotation after the label, e.g. the benchmark a beta is measured against. */
  suffix?: string;
  tip: string;
  sortKey: SortKey;
  sort: SortState<SortKey>;
  onSort: (key: SortKey) => void;
}) {
  return (
    <Th
      align="right"
      sort={sort}
      sortKey={sortKey}
      onSort={onSort}
      after={<InfoTip text={tip} overlay />}
    >
      {label}
      {suffix && <span className="normal-case text-zinc-400 dark:text-zinc-500"> ({suffix})</span>}
    </Th>
  );
}

// --- Correlation heatmap -----------------------------------------------------

const CORR_BLUE = "59,130,246"; // r = -1
const CORR_RED = "239,68,68"; // r = +1
const CORR_LABEL_W = 96; // px, row-label column
const CORR_CELL_MAX = 56; // px, cap per the design spec
const CORR_CELL_MIN = 32; // px, below this the matrix scrolls instead of shrinking further

/** Diverging blue→neutral→red background for a correlation value in [-1, 1]. */
function corrBg(c: number): string {
  const alpha = Math.min(0.85, Math.abs(c));
  const rgb = c >= 0 ? CORR_RED : CORR_BLUE;
  return `rgba(${rgb},${alpha})`;
}

function CorrelationMatrix({ labels, corr }: { labels: string[]; corr: number[][] }) {
  const { t } = useI18n();
  const n = labels.length;
  const [hovered, setHovered] = useState<{ i: number; j: number } | null>(null);
  const hasHighCorr = useMemo(
    () => corr.some((row, i) => row.some((c, j) => i !== j && Math.abs(c) >= 0.8)),
    [corr],
  );

  return (
    <div className="mt-3">
      <div className="overflow-x-auto">
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `${CORR_LABEL_W}px repeat(${n}, minmax(${CORR_CELL_MIN}px, 1fr))`,
            width: `min(100%, ${CORR_LABEL_W + n * CORR_CELL_MAX}px)`,
            minWidth: `${CORR_LABEL_W + n * CORR_CELL_MIN}px`,
          }}
        >
          <div />
          {labels.map((l, j) => (
            <div
              key={`col-${j}`}
              className="flex items-end justify-center overflow-hidden pb-1 text-center text-[10px] font-medium text-zinc-500"
              title={l}
            >
              <span className="truncate">{l}</span>
            </div>
          ))}
          {labels.map((row, i) => (
            <Fragment key={`row-${i}`}>
              <div
                className="flex items-center justify-end overflow-hidden pr-2 text-right text-[10px] font-medium text-zinc-500"
                title={row}
              >
                <span className="truncate">{row}</span>
              </div>
              {labels.map((col, j) => {
                const value = corr[i][j];
                const diag = i === j;
                const highCorr = !diag && Math.abs(value) >= 0.8;
                const isHovered = hovered?.i === i && hovered?.j === j;
                const alpha = Math.min(0.85, Math.abs(value));
                const ink = diag
                  ? "text-zinc-400 dark:text-zinc-500"
                  : alpha > 0.5
                    ? "text-white"
                    : "text-zinc-700 dark:text-zinc-200";
                const ring = isHovered
                  ? "ring-2 ring-zinc-900 dark:ring-white"
                  : highCorr
                    ? "ring-1 ring-amber-500/60"
                    : "";
                return (
                  <button
                    key={`cell-${i}-${j}`}
                    type="button"
                    title={`${row} × ${col}: ${value.toFixed(2)}`}
                    onMouseEnter={() => setHovered({ i, j })}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered({ i, j })}
                    onBlur={() => setHovered(null)}
                    className={`flex items-center justify-center rounded text-xs tabular-nums transition-shadow ${diag ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${ink} ${ring}`}
                    style={{
                      aspectRatio: "1 / 1",
                      backgroundColor: diag ? undefined : corrBg(value),
                    }}
                  >
                    {value.toFixed(2)}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* legend: diverging scale from -1 (blue) through 0 (neutral) to +1 (red) */}
      <div className="mt-4 max-w-xs">
        <div
          className="h-2 rounded-full"
          style={{
            background: `linear-gradient(to right, rgba(${CORR_BLUE},0.85), rgba(161,161,170,0.2), rgba(${CORR_RED},0.85))`,
          }}
        />
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
          <span>−1</span>
          <span>0</span>
          <span>+1</span>
        </div>
      </div>

      {hasHighCorr && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">{t("risk.correlationHighPairs")}</p>
      )}
    </div>
  );
}
