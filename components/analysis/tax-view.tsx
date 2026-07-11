"use client";

// Steuern tab: a per-year German capital-gains tax (Abgeltungsteuer) waterfall,
// legible to a private investor: raw gains/dividends/interest, the
// Sparerpauschbetrag, an estimated bill, and how that compares to what the
// broker already withheld. Settings (allowance, Kirchensteuer,
// Teilfreistellung) live on /settings. This is a rough estimate for
// orientation, not tax advice; see lib/finance/tax.ts for the scope and
// simplifications (per-pot loss handling, no Vorabpauschale, ...).

import { useMemo, type ReactNode } from "react";
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
import { formatCurrency, formatPercent, plColor } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { useI18n } from "@/lib/i18n/i18n-context";

export function TaxView() {
  const { data } = usePortfolio();
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

  const years = useMemo(() => {
    const settings: TaxSettings = {
      allowance: data.profile.taxAllowance,
      churchTaxRate: data.profile.churchTaxRate,
      applyTeilfreistellung: data.profile.taxTeilfreistellung,
    };
    return taxYearBreakdown(data.assets, data.transactions, dividendsByYear, settings, valuation);
  }, [
    data.assets,
    data.transactions,
    dividendsByYear,
    data.profile.taxAllowance,
    data.profile.churchTaxRate,
    data.profile.taxTeilfreistellung,
    valuation,
  ]);

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
            const sumIncome = y.stockGains + fundGainsDisplay + dividendsTotal + y.interest;
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
                  <Row
                    label={
                      <>
                        {t("tax.withheld")}
                        <InfoTip text={t("tax.withheldTip")} className="ml-1" />
                      </>
                    }
                    value={formatCurrency(y.taxWithheld, currency)}
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

                <h4 className="mt-4 border-t border-zinc-200 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                  {t("tax.notIncluded")}
                </h4>
                <dl className="mt-2 space-y-1.5 text-sm">
                  {y.privateSale !== 0 && (
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
                  )}
                  <Row
                    label={
                      <>
                        {t("tax.vorab")}
                        <InfoTip text={t("tax.vorabTip")} className="ml-1" />
                      </>
                    }
                    value={t("tax.vorabNotComputed")}
                    numeric={false}
                  />
                </dl>
              </Card>
            );
          })}
        </div>
      )}
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
