// German capital-gains tax report (Kapitalertragsteuer / Abgeltungsteuer),
// legible to a private investor: per calendar year, the Sparerpauschbetrag
// (allowance), Kirchensteuer (church tax) and Teilfreistellung (partial
// exemption for equity funds) are folded into a waterfall from raw gains down
// to an estimated tax bill. This supersedes the old flat gross/net
// `taxYearReport` in trades.ts, which mirrors the same average-cost replay of
// the transaction log but does not model the German tax pots at all. Real
// dividend events are supplied by the caller (from /api/dividends) via
// `dividendsByYear`; this module has no network/React access.
//
// Pure, no React. This is an estimate for orientation only, not tax advice:
// German capital-gains tax has many special cases (loss carryforwards across
// years, ...) that are deliberately out of scope; see `privateSale`, which
// stays informational only. Vorabpauschale (a notional tax pre-payment on
// accumulating funds) can't be computed from transaction data, so it is
// entered manually per year (`TaxSettings.vorabpauschale`) rather than
// derived here.
//
// Per-broker Freistellungsauftrag allocation (`TaxSettings.portfolioAllowances`)
// IS modeled, approximately: portfolios (transactions carry `portfolioId`)
// represent brokers, and a broker's own Freistellungsauftrag can only shield
// gains realized AT that broker. Stock/fund sells and cash interest are
// portfolio-attributable (the transaction log knows which portfolio each
// happened in); real dividend events and the manually entered Vorabpauschale
// are not — the caller pools dividends across all portfolios holding an asset
// before calling in (see tax-view.tsx's `dividendsByYear`), and Vorabpauschale
// is a single manual entry per year, not per broker. See `taxYearBreakdown`
// for the exact allocation rule.

import type { Asset, Transaction } from "../types";
import type { ValuationContext } from "./portfolio";

/** Native-currency → base-currency spot rate for an asset (mirrors trades.ts). */
function rateOf(asset: Asset, v?: ValuationContext): number {
  const cur = asset.currency ?? v?.base ?? "";
  if (!v || !cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

const byDateAsc = (a: Transaction, b: Transaction) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

export interface TaxSettings {
  /** Sparerpauschbetrag, base currency (1000 single / 2000 joint filing). */
  allowance: number;
  /** Kirchensteuer rate: 0, 0.08 or 0.09. */
  churchTaxRate: number;
  /** Apply the 30% Teilfreistellung for equity fund (ETF) gains/dividends. */
  applyTeilfreistellung: boolean;
  /** Manually entered Vorabpauschale per year ("2025" -> raw amount, base currency), from the broker's annual tax statement. */
  vorabpauschale: Record<string, number>;
  /** Manual override of the tax withheld by the broker per year; replaces the transaction-derived sum when set. */
  withheldOverride: Record<string, number>;
  /**
   * Registered Freistellungsauftrag per broker (portfolio id -> base-currency
   * amount), for users who split their Sparerpauschbetrag across brokers.
   * Only portfolios with an amount registered are included — when this map
   * is empty, `allowanceUsed` falls back to `allowance` exactly as before
   * (single global pot). A single amount applies to every year (the app does
   * not historize registered allowances per year). See `taxYearBreakdown`.
   */
  portfolioAllowances?: Record<string, number>;
}

/** Real dividend income for a year, split by the pot it feeds (Aktien vs. sonstige Kapitalerträge). */
export interface YearDividends {
  stock: number;
  fund: number;
}

export interface TaxYearBreakdown {
  year: string;
  /** STOCK sells: (proceeds - sell fee) - average-cost basis, base currency. */
  stockGains: number;
  /** ETF sells, same formula, BEFORE Teilfreistellung. */
  fundGains: number;
  dividendsStock: number;
  /** Fund dividends, AFTER Teilfreistellung when applied (feeds the pots below). */
  dividendsFund: number;
  interest: number;
  /** CRYPTO + COMMODITY realized gains (private sale, §23 EStG); informational only, never in kapitalertraege. */
  privateSale: number;
  teilfreistellungApplied: boolean;
  /** Aktien-Topf (floored at 0) + sonstige-Topf (floored at 0). */
  kapitalertraege: number;
  allowanceUsed: number;
  taxableAfterAllowance: number;
  /** Abgeltungsteuer incl. Soli + Kirchensteuer, as a fraction. */
  effectiveRate: number;
  estimatedTax: number;
  /** Effective tax withheld: `settings.withheldOverride[year]` when set, else `taxWithheldComputed`. */
  taxWithheld: number;
  /** Sum of tax withheld (t.tax) on STOCK/ETF sells that year, from the transaction log alone. */
  taxWithheldComputed: number;
  /** Manually entered Vorabpauschale for the year, AFTER Teilfreistellung when applied (feeds the sonstige pot, mirrors the `dividendsFund` convention). */
  vorabpauschale: number;
  /**
   * Per-broker allowance usage, only present when `settings.portfolioAllowances`
   * has at least one entry. One row per portfolio with a registered allowance,
   * `used` capped at that portfolio's own portfolio-attributable Kapitalerträge
   * for the year (stock/fund gains + interest booked in that portfolio) —
   * see `taxYearBreakdown`.
   */
  allowanceByPortfolio?: { portfolioId: string; used: number; registered: number }[];
}

/**
 * Abgeltungsteuer rate including the 5.5% solidarity surcharge and, if
 * applicable, Kirchensteuer at rate `churchTaxRate` (0, 0.08 or 0.09). With
 * church tax the base 25% itself is reduced by the standard formula so the
 * combined burden stays commensurate: 0 -> 26.375%, 0.08 -> ~27.819%,
 * 0.09 -> ~27.995%.
 */
export function abgeltungRate(churchTaxRate: number): number {
  const k = churchTaxRate;
  return k > 0 ? (1 / (4 + k)) * (1 + 0.055 + k) : 0.25 * 1.055;
}

/** A portfolio's (broker's) own contribution to a year's stock/fund gains and
 *  interest — the subset of a year's Kapitalerträge that is portfolio-attributable
 *  (see the module-level comment on per-broker allowance allocation). */
interface PortfolioAccum {
  stockGains: number;
  fundGains: number;
  interest: number;
}

function emptyPortfolioAccum(): PortfolioAccum {
  return { stockGains: 0, fundGains: 0, interest: 0 };
}

interface YearAccum {
  stockGains: number;
  fundGains: number;
  interest: number;
  privateSale: number;
  taxWithheld: number;
  byPortfolio: Map<string, PortfolioAccum>;
}

function emptyAccum(): YearAccum {
  return {
    stockGains: 0,
    fundGains: 0,
    interest: 0,
    privateSale: 0,
    taxWithheld: 0,
    byPortfolio: new Map(),
  };
}

function portfolioAccum(acc: YearAccum, portfolioId: string): PortfolioAccum {
  let p = acc.byPortfolio.get(portfolioId);
  if (!p) {
    p = emptyPortfolioAccum();
    acc.byPortfolio.set(portfolioId, p);
  }
  return p;
}

/**
 * Per-calendar-year German tax breakdown, replaying the transaction log with
 * average-cost basis per asset (same replay as trades.ts). Only years with at
 * least one contributing event (a sell, interest credit, or real dividend) are
 * returned, sorted newest first.
 */
export function taxYearBreakdown(
  assets: Asset[],
  txs: Transaction[],
  dividendsByYear: Record<string, YearDividends>,
  settings: TaxSettings,
  v?: ValuationContext,
): TaxYearBreakdown[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const byAsset = new Map<string, Transaction[]>();
  for (const t of txs) {
    const list = byAsset.get(t.assetId);
    if (list) list.push(t);
    else byAsset.set(t.assetId, [t]);
  }

  const years = new Map<string, YearAccum>();
  const yearOf = (t: Transaction) => t.date.slice(0, 4);
  const bucket = (year: string): YearAccum => {
    let b = years.get(year);
    if (!b) {
      b = emptyAccum();
      years.set(year, b);
    }
    return b;
  };

  for (const [assetId, atxs] of byAsset) {
    const asset = byId.get(assetId);
    if (!asset) continue;
    const rate = rateOf(asset, v);
    let shares = 0;
    let avgCost = 0;
    for (const t of [...atxs].sort(byDateAsc)) {
      if (t.type === "BUY" || t.type === "BOOKING" || t.type === "INTEREST") {
        if (t.type === "INTEREST") {
          // Cash interest: the credited amount is income in the year received
          // (mirrors trades.ts's taxYearReport bucketing). Interest is
          // portfolio-attributable (the cash asset sits in one portfolio).
          const amount = t.quantity * t.price * rate;
          const b = bucket(yearOf(t));
          b.interest += amount;
          portfolioAccum(b, t.portfolioId).interest += amount;
        }
        // BOOKING (free crediting) and INTEREST both add shares at zero cost
        // basis; only a fee/tax (if any) raises it.
        const cost = t.type === "BUY" ? t.quantity * t.price + t.fee + t.tax : t.fee + t.tax;
        const ns = shares + t.quantity;
        avgCost = ns > 0 ? (shares * avgCost + cost) / ns : 0;
        shares = ns;
      } else {
        // SELL. CASH sells are withdrawals, not taxable events: no bucket
        // contribution, but shares/avgCost still advance below.
        if (asset.type !== "CASH") {
          // Sell fee reduces the taxable gain; tax withheld does NOT (it is
          // tracked separately in taxWithheld to compare against the
          // estimated bill).
          const taxableGain = (t.quantity * t.price - t.fee - t.quantity * avgCost) * rate;
          const b = bucket(yearOf(t));
          if (asset.type === "STOCK") {
            b.stockGains += taxableGain;
            b.taxWithheld += t.tax * rate;
            // Stock/fund sells are portfolio-attributable: they carry
            // portfolioId, so a broker's own Freistellungsauftrag can only
            // shield gains realized at that broker.
            portfolioAccum(b, t.portfolioId).stockGains += taxableGain;
          } else if (asset.type === "ETF") {
            b.fundGains += taxableGain;
            b.taxWithheld += t.tax * rate;
            portfolioAccum(b, t.portfolioId).fundGains += taxableGain;
          } else if (asset.type === "CRYPTO" || asset.type === "COMMODITY") {
            b.privateSale += taxableGain;
          }
        }
        shares -= t.quantity;
        if (shares <= 1e-9) {
          shares = 0;
          avgCost = 0;
        }
      }
    }
  }

  const allYears = new Set<string>([
    ...years.keys(),
    ...Object.keys(dividendsByYear),
    ...Object.keys(settings.vorabpauschale).filter((y) => settings.vorabpauschale[y] !== 0),
    ...Object.keys(settings.withheldOverride).filter((y) => settings.withheldOverride[y] !== 0),
  ]);
  const rate = abgeltungRate(settings.churchTaxRate);
  const out: TaxYearBreakdown[] = [];

  for (const year of allYears) {
    const acc = years.get(year) ?? emptyAccum();
    const div = dividendsByYear[year] ?? { stock: 0, fund: 0 };
    const vorabRaw = settings.vorabpauschale[year] ?? 0;
    const withheldOverride = settings.withheldOverride[year];

    const hasEvent =
      acc.stockGains !== 0 ||
      acc.fundGains !== 0 ||
      acc.interest !== 0 ||
      acc.privateSale !== 0 ||
      acc.taxWithheld !== 0 ||
      div.stock !== 0 ||
      div.fund !== 0 ||
      vorabRaw !== 0 ||
      (withheldOverride ?? 0) !== 0;
    if (!hasEvent) continue;

    // Teilfreistellung applies to fund gains AND fund dividends alike, before
    // pooling, including losses (a fund loss is reduced by 30% too).
    const fundGainsAfterTF = settings.applyTeilfreistellung ? acc.fundGains * 0.7 : acc.fundGains;
    const dividendsFundAfterTF = settings.applyTeilfreistellung ? div.fund * 0.7 : div.fund;
    // Vorabpauschale is fund income under German law (InvStG), so
    // Teilfreistellung applies exactly like fund dividends.
    const vorabAfterTF = settings.applyTeilfreistellung ? vorabRaw * 0.7 : vorabRaw;

    const aktienPos = Math.max(0, acc.stockGains);
    const sonstige =
      fundGainsAfterTF + dividendsFundAfterTF + div.stock + acc.interest + vorabAfterTF;
    const sonstigePos = Math.max(0, sonstige);
    const kapitalertraege = aktienPos + sonstigePos;

    // Allowance allocation. Default: a single global pot (Sparerpauschbetrag),
    // exactly as before. When at least one broker has a registered
    // Freistellungsauftrag, allocate per broker instead: each portfolio's own
    // allowance can only shield that portfolio's own portfolio-attributable
    // gains (stock/fund sells + interest booked in it, floored at 0 exactly
    // like the Aktien-/sonstige-Topf split above but scoped to the portfolio).
    // Components that aren't portfolio-attributable — pooled dividend events
    // and the manually entered Vorabpauschale — plus any gains booked at a
    // portfolio with NO registered allowance, form a "pooled remainder";
    // whatever registered allowance is left over after covering its own
    // portfolio is applied against that remainder. This mirrors how
    // Freistellungsaufträge actually work (unused allowance at broker A does
    // NOT retroactively shield broker B's withholding) while still giving an
    // estimate for the parts this app can't attribute to a single broker.
    const portfolioAllowances = settings.portfolioAllowances ?? {};
    const hasPortfolioAllowances = Object.keys(portfolioAllowances).length > 0;
    let allowanceUsed: number;
    let allowanceByPortfolio: TaxYearBreakdown["allowanceByPortfolio"];

    if (!hasPortfolioAllowances) {
      allowanceUsed = Math.min(settings.allowance, kapitalertraege);
    } else {
      const portfolioIds = new Set<string>([
        ...acc.byPortfolio.keys(),
        ...Object.keys(portfolioAllowances),
      ]);
      let attributableSum = 0;
      let usedSum = 0;
      let leftoverSum = 0;
      const rows: { portfolioId: string; used: number; registered: number }[] = [];
      for (const portfolioId of [...portfolioIds].sort()) {
        const pb = acc.byPortfolio.get(portfolioId) ?? emptyPortfolioAccum();
        const pAktienPos = Math.max(0, pb.stockGains);
        const pFundAfterTF = settings.applyTeilfreistellung ? pb.fundGains * 0.7 : pb.fundGains;
        const pSonstigePos = Math.max(0, pFundAfterTF + pb.interest);
        const pKapitalertraege = pAktienPos + pSonstigePos;
        attributableSum += pKapitalertraege;

        const registered = portfolioAllowances[portfolioId];
        if (registered != null) {
          const used = Math.min(registered, pKapitalertraege);
          usedSum += used;
          leftoverSum += Math.max(0, registered - pKapitalertraege);
          rows.push({ portfolioId, used, registered });
        }
      }
      // The pooled remainder can only be the genuinely non-attributable slice
      // (dividends/Vorabpauschale, or gains at unregistered portfolios) —
      // never negative even if per-portfolio floors sum differently than the
      // single combined pot above (e.g. offsetting gains/losses across
      // portfolios).
      const pooledRemainder = Math.max(0, kapitalertraege - attributableSum);
      const pooledUsed = Math.min(leftoverSum, pooledRemainder);
      allowanceUsed = Math.min(kapitalertraege, usedSum + pooledUsed);
      allowanceByPortfolio = rows;
    }

    const taxableAfterAllowance = Math.max(0, kapitalertraege - allowanceUsed);
    const estimatedTax = taxableAfterAllowance * rate;

    out.push({
      year,
      stockGains: acc.stockGains,
      fundGains: acc.fundGains,
      dividendsStock: div.stock,
      dividendsFund: dividendsFundAfterTF,
      interest: acc.interest,
      privateSale: acc.privateSale,
      teilfreistellungApplied: settings.applyTeilfreistellung,
      kapitalertraege,
      allowanceUsed,
      taxableAfterAllowance,
      effectiveRate: rate,
      estimatedTax,
      taxWithheld: withheldOverride ?? acc.taxWithheld,
      taxWithheldComputed: acc.taxWithheld,
      vorabpauschale: vorabAfterTF,
      allowanceByPortfolio,
    });
  }

  return out.sort((a, b) => (a.year < b.year ? 1 : -1));
}
