// Ausgabeaufschlag (front-end load) — pure, no React, no lib/server imports.
//
// An actively managed fund is not bought at its net asset value: the
// Ausgabepreis is the NAV plus a surcharge, so a 100 EUR order at a NAV of 10
// with 5% does NOT buy 10 units, it buys 100 / 10.50 = 9.5238 of them and
// 4.76 EUR of the money never became fund units.
//
// Two ways to book that, and only one of them is right here:
//
//   - Lower the price to the offer price. The cost basis would come out right,
//     but every chart and P&L reading would then compare the fund's NAV series
//     against a price no listing ever printed, and the surcharge would silently
//     disappear into "the fund is up".
//   - Keep the NAV as the price and post the surcharge as the transaction's
//     `fee`. `lib/finance/portfolio.ts` already adds a buy's fee to the cost
//     basis, so the total cost is exactly the money that left the account, the
//     surcharge stays a visible cost, and the price series stays the fund's.
//
// The second one is what this module computes.

import type { Asset, SavingsPlan } from "../types";

/**
 * The surcharge in force for one purchase, in percent.
 *
 * A plan's own rate wins over the fund's whenever it is set — including when it
 * is set to zero, which is the whole point: "my broker waives it on this plan"
 * has to be expressible, and reading 0 as "unset" would make it unsayable.
 */
export function frontLoadPercent(
  asset: Pick<Asset, "frontLoad"> | null | undefined,
  plan?: Pick<SavingsPlan, "frontLoad"> | null,
): number {
  const raw = plan?.frontLoad ?? asset?.frontLoad ?? 0;
  return Number.isFinite(raw) && (raw as number) > 0 ? (raw as number) : 0;
}

export interface FrontLoadSplit {
  /** Ausgabepreis: what one unit actually costs, NAV x (1 + rate). */
  offerPrice: number;
  /** Units the gross amount buys at the offer price. */
  quantity: number;
  /** The surcharge in currency: gross minus quantity x NAV. */
  charge: number;
}

/**
 * Splits a gross investment into the units it buys and the surcharge paid.
 *
 * `gross` is the money leaving the account (a savings plan's amount), `nav` the
 * fund's net asset value per unit. A zero or unusable rate degenerates to the
 * plain `gross / nav` every other purchase already used, so callers need no
 * branch of their own.
 */
export function frontLoadSplit(gross: number, nav: number, percent: number): FrontLoadSplit {
  if (!Number.isFinite(nav) || nav <= 0 || !Number.isFinite(gross)) {
    return { offerPrice: nav, quantity: NaN, charge: 0 };
  }
  const rate = Number.isFinite(percent) && percent > 0 ? percent / 100 : 0;
  const offerPrice = nav * (1 + rate);
  const quantity = gross / offerPrice;
  return { offerPrice, quantity, charge: gross - quantity * nav };
}

/**
 * The surcharge on a purchase whose SIZE is already fixed — a manual buy, where
 * the user typed units and a price rather than an amount to invest.
 *
 * Here the surcharge sits on top (`volume x rate`) instead of coming out of a
 * fixed budget, which is a different number from `frontLoadSplit`'s `charge`
 * at the same rate, and the reason both exist.
 */
export function frontLoadOnVolume(volume: number, percent: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  const rate = Number.isFinite(percent) && percent > 0 ? percent / 100 : 0;
  return volume * rate;
}
