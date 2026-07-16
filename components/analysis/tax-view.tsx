"use client";

// Steuern tab: a per-year German capital-gains tax (Abgeltungsteuer) waterfall,
// legible to a private investor: raw gains/dividends/interest, the
// Sparerpauschbetrag, an estimated bill, and how that compares to what the
// broker already withheld. Settings (allowance, Kirchensteuer,
// Teilfreistellung) live on /settings; Vorabpauschale and the withheld tax
// are entered manually per year here (see EditableAmountRow below). This is
// a rough estimate for orientation, not tax advice; see lib/finance/tax.ts
// for the scope and simplifications (per-pot loss handling, ...).

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { quoteItemFor } from "@/lib/finance/prices";
import { transactionsByAsset } from "@/lib/finance/portfolio";
import { useDividends } from "@/lib/history/use-dividends";
import { dividendsFromEvents } from "@/lib/finance/dividends";
import { taxYearBreakdown, type TaxSettings, type YearDividends } from "@/lib/finance/tax";
import { assetPriceKey } from "@/lib/types";
import { formatCurrency, formatPercent, parseDecimal, plColor } from "@/lib/format";
import { isStorageFullError } from "@/lib/store/errors";
import { Card } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { useI18n } from "@/lib/i18n/i18n-context";

export function TaxView() {
  const { data, updateProfile } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const { t } = useI18n();
  const currency = data.profile.currency;

  const histItems = useMemo(
    () =>
      data.assets
        .map(quoteItemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { dividends: divMap } = useDividends(histItems);

  // Real dividend events, scaled by shares held on each pay date (same as
  // trades-view's dividendsReceived / dividends-view), bucketed per calendar
  // year and per tax pot (fund vs. stock).
  const dividendsByYear = useMemo(() => {
    const fx = valuation.fx ?? {};
    const out: Record<string, YearDividends> = {};
    for (const asset of data.assets) {
      const events = divMap[assetPriceKey(asset)];
      if (!events || events.length === 0) continue;
      const txs = transactionsByAsset(asset.id, data.transactions);
      const payments = dividendsFromEvents(events, txs);
      if (payments.length === 0) continue;
      const cur = asset.currency ?? currency;
      const rate = cur === currency ? 1 : (fx[cur] ?? 1);
      for (const p of payments) {
        const year = p.date.slice(0, 4);
        const bucket = out[year] ?? (out[year] = { stock: 0, fund: 0 });
        const amount = p.total * rate;
        if (asset.type === "ETF") bucket.fund += amount;
        else bucket.stock += amount;
      }
    }
    return out;
  }, [divMap, data.assets, data.transactions, currency, valuation]);

  // Registered Freistellungsauftrag per broker (portfolio): only portfolios
  // with a value set are included. Empty map = no per-broker allocation, and
  // taxYearBreakdown falls back to the single global allowance below.
  const portfolioAllowances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of data.portfolios) {
      if (p.taxAllowance != null) map[p.id] = p.taxAllowance;
    }
    return map;
  }, [data.portfolios]);

  const years = useMemo(() => {
    const settings: TaxSettings = {
      allowance: data.profile.taxAllowance,
      churchTaxRate: data.profile.churchTaxRate,
      applyTeilfreistellung: data.profile.taxTeilfreistellung,
      vorabpauschale: data.profile.taxVorabpauschale,
      withheldOverride: data.profile.taxWithheldOverride,
      portfolioAllowances,
    };
    return taxYearBreakdown(data.assets, data.transactions, dividendsByYear, settings, valuation);
  }, [
    data.assets,
    data.transactions,
    dividendsByYear,
    data.profile.taxAllowance,
    data.profile.churchTaxRate,
    data.profile.taxTeilfreistellung,
    data.profile.taxVorabpauschale,
    data.profile.taxWithheldOverride,
    portfolioAllowances,
    valuation,
  ]);

  const portfolioName = (id: string) => data.portfolios.find((p) => p.id === id)?.name ?? id;

  const setVorabpauschale = async (year: string, raw: number | null) => {
    const next = { ...data.profile.taxVorabpauschale };
    if (raw === null) delete next[year];
    else next[year] = raw;
    await updateProfile({ taxVorabpauschale: next });
  };

  const setWithheldOverride = async (year: string, raw: number | null) => {
    const next = { ...data.profile.taxWithheldOverride };
    if (raw === null) delete next[year];
    else next[year] = raw;
    await updateProfile({ taxWithheldOverride: next });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        {t("tax.disclaimer")}{" "}
        <Link href="/settings" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
          {t("tax.settingsLink")}
        </Link>
      </p>

      {years.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500">{t("tax.empty")}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {years.map((y) => {
            const fundGainsDisplay = y.teilfreistellungApplied ? y.fundGains * 0.7 : y.fundGains;
            const dividendsTotal = y.dividendsStock + y.dividendsFund;
            const sumIncome =
              y.stockGains + fundGainsDisplay + dividendsTotal + y.interest + y.vorabpauschale;
            const diff = y.estimatedTax - y.taxWithheld;
            const diffLabel = diff > 0 ? t("tax.additionalOwed") : t("tax.refund");

            return (
              <Card key={y.year}>
                <h3 className="text-base font-semibold">{y.year}</h3>

                <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {t("tax.capitalIncome")}
                </h4>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <Row
                    label={
                      <>
                        {t("tax.stockGains")}
                        <InfoTip text={t("tax.stockGainsTip")} className="ml-1" />
                      </>
                    }
                    value={formatCurrency(y.stockGains, currency)}
                    valueClassName={plColor(y.stockGains)}
                  />
                  <Row
                    label={
                      y.teilfreistellungApplied
                        ? `${t("tax.fundGains")} ${t("tax.tfSuffix")}`
                        : t("tax.fundGains")
                    }
                    value={formatCurrency(fundGainsDisplay, currency)}
                    valueClassName={plColor(fundGainsDisplay)}
                  />
                  <Row
                    label={t("tax.dividends")}
                    value={formatCurrency(dividendsTotal, currency)}
                    valueClassName={dividendsTotal !== 0 ? plColor(dividendsTotal) : ""}
                  />
                  <Row
                    label={t("tax.interest")}
                    value={formatCurrency(y.interest, currency)}
                    valueClassName={y.interest !== 0 ? plColor(y.interest) : ""}
                  />
                  <EditableAmountRow
                    key={`vorab-${y.year}-${data.profile.taxVorabpauschale[y.year] ?? ""}`}
                    label={
                      <>
                        {y.teilfreistellungApplied
                          ? `${t("tax.vorab")} ${t("tax.tfSuffix")}`
                          : t("tax.vorab")}
                        <InfoTip text={t("tax.vorabTip")} className="ml-1" />
                      </>
                    }
                    ariaLabel={t("tax.vorabAriaLabel", { year: y.year })}
                    initial={data.profile.taxVorabpauschale[y.year]}
                    currency={currency}
                    onCommit={(raw) => setVorabpauschale(y.year, raw)}
                  />
                  <div className="!mt-2.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
                    <Row
                      label={t("tax.sumIncome")}
                      value={formatCurrency(sumIncome, currency)}
                      valueClassName={plColor(sumIncome)}
                      bold
                    />
                  </div>
                  <Row
                    label={
                      <>
                        {t("tax.allowance")}
                        <InfoTip text={t("tax.allowanceTip")} className="ml-1" />
                      </>
                    }
                    value={`− ${formatCurrency(y.allowanceUsed, currency)}`}
                  />
                  {y.allowanceByPortfolio && y.allowanceByPortfolio.length > 0 && (
                    <div className="pl-2 text-xs text-zinc-400">
                      <p>{t("tax.allowanceByBroker")}</p>
                      <div className="mt-0.5 space-y-0.5">
                        {y.allowanceByPortfolio.map((row) => (
                          <div key={row.portfolioId} className="flex justify-between gap-4">
                            <span className="truncate">{portfolioName(row.portfolioId)}</span>
                            <span className="shrink-0 tabular-nums" data-private="">
                              {formatCurrency(row.used, currency)} /{" "}
                              {formatCurrency(row.registered, currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="!mt-2.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
                    <Row
                      label={t("tax.taxable")}
                      value={formatCurrency(y.taxableAfterAllowance, currency)}
                      bold
                    />
                  </div>
                  <Row
                    label={
                      <>
                        {t("tax.estimatedTax")} ({formatPercent(y.effectiveRate)})
                        <InfoTip text={t("tax.estimatedTaxTip")} className="ml-1" />
                        <EstimatedBadge compact />
                      </>
                    }
                    value={formatCurrency(y.estimatedTax, currency)}
                    bold
                  />
                  <EditableAmountRow
                    key={`withheld-${y.year}-${data.profile.taxWithheldOverride[y.year] ?? ""}`}
                    label={
                      <>
                        {t("tax.withheld")}
                        <InfoTip text={t("tax.withheldTip")} className="ml-1" />
                      </>
                    }
                    ariaLabel={t("tax.withheldAriaLabel", { year: y.year })}
                    initial={data.profile.taxWithheldOverride[y.year]}
                    placeholder={formatCurrency(y.taxWithheldComputed, currency)}
                    currency={currency}
                    onCommit={(raw) => setWithheldOverride(y.year, raw)}
                  />
                  <div className="!mt-2.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
                    <Row
                      label={
                        <>
                          {diffLabel}
                          <InfoTip text={t("tax.diffTip")} className="ml-1" />
                        </>
                      }
                      value={formatCurrency(Math.abs(diff), currency)}
                      valueClassName={plColor(diff > 0 ? -1 : 1)}
                      bold
                    />
                  </div>
                </dl>

                {y.privateSale !== 0 && (
                  <>
                    <h4 className="mt-4 border-t border-zinc-200 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                      {t("tax.notIncluded")}
                    </h4>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <Row
                        label={
                          <>
                            {t("tax.privateSale")}
                            <InfoTip text={t("tax.privateSaleTip")} className="ml-1" />
                          </>
                        }
                        value={formatCurrency(y.privateSale, currency)}
                        valueClassName={plColor(y.privateSale)}
                      />
                    </dl>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A dl row whose value is a manually entered amount (Vorabpauschale, withheld
 * tax override). Locked by default (plain text like the sibling `Row`, or the
 * muted placeholder/em-dash when unset) with a pen button that enters edit
 * mode; edit mode swaps in the number input plus explicit apply (✓) / discard
 * (✕) buttons — blur alone never commits, only Enter/✓ (apply) or
 * Escape/✕ (discard). Local input state is initialized from `initial` and
 * re-seeded via the `key` prop the caller passes (year + stored value) rather
 * than syncing through an effect.
 */
function EditableAmountRow({
  label,
  ariaLabel,
  initial,
  placeholder,
  currency,
  onCommit,
}: {
  label: ReactNode;
  ariaLabel: string;
  initial: number | undefined;
  placeholder?: string;
  currency: string;
  onCommit: (raw: number | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const seedText = () => (initial !== undefined ? String(initial) : "");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(seedText);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setText(seedText());
    setError(null);
    setEditing(true);
  };

  const discard = () => {
    setText(seedText());
    setError(null);
    setEditing(false);
  };

  const commit = async () => {
    const parsed = parseDecimal(text);
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    setText(next !== null ? String(next) : "");
    try {
      await onCommit(next);
      setError(null);
      setEditing(false);
    } catch (err) {
      // Stay in edit mode on failure so the entry (and the error) survives.
      setError(isStorageFullError(err) ? t("common.storageFull") : t("tax.saveError"));
    }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="flex items-center text-zinc-500">{label}</dt>
        <dd className="flex items-center justify-end gap-1" data-private="">
          {editing ? (
            <>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                autoFocus
                value={text}
                placeholder={placeholder}
                aria-label={ariaLabel}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commit();
                  if (e.key === "Escape") discard();
                }}
                className="w-32 rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
              <button
                type="button"
                onClick={() => void commit()}
                title={t("tax.applyAriaLabel", { field: ariaLabel })}
                aria-label={t("tax.applyAriaLabel", { field: ariaLabel })}
                className="shrink-0 rounded-md px-2 py-1 text-sm text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={discard}
                title={t("tax.discardAriaLabel", { field: ariaLabel })}
                aria-label={t("tax.discardAriaLabel", { field: ariaLabel })}
                className="shrink-0 rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <span className={`tabular-nums ${initial === undefined ? "text-zinc-400" : ""}`}>
                {initial !== undefined ? formatCurrency(initial, currency) : (placeholder ?? "—")}
              </span>
              <button
                type="button"
                onClick={startEdit}
                title={t("tax.editAriaLabel", { field: ariaLabel })}
                aria-label={t("tax.editAriaLabel", { field: ariaLabel })}
                className="shrink-0 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ✎
              </button>
            </>
          )}
        </dd>
      </div>
      {error && <p className="mt-1 text-right text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  valueClassName = "",
  bold = false,
  numeric = true,
}: {
  label: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  bold?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${bold ? "font-semibold" : ""}`}>
      <dt className="flex items-center text-zinc-500">{label}</dt>
      <dd
        className={`text-right ${numeric ? "tabular-nums" : ""} ${valueClassName}`}
        {...(numeric ? { "data-private": "" } : {})}
      >
        {value}
      </dd>
    </div>
  );
}
