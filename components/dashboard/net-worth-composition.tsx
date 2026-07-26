"use client";

// The net-worth headline, written out as the sum of the areas it comes from.
//
// The dashboard computed `netWorth = holdings + accounts - liabilities` and
// then showed only the result, surrounded by five investment-only KPIs. That
// is what made the app read as a portfolio tracker with unrelated features
// parked next to it: nothing on the home screen admitted that Accounts and
// Debt were part of the same number. Spelling the equation out — and linking
// each term to the area it belongs to — is the smallest honest way to say
// "one product".
//
// Deliberately not a chart: the terms carry opposite signs, and a stacked bar
// either hides the liability or misstates the proportions.

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-context";
import { formatCurrency } from "@/lib/format";

type Term = {
  /** Where this part of net worth is managed. */
  href: string;
  label: string;
  /** Base-currency magnitude, always positive; `sign` carries the direction. */
  amount: number;
  sign: "+" | "−";
};

export function NetWorthComposition({
  investments,
  accountAssets,
  liabilities,
  currency,
}: {
  investments: number;
  /** Positive balances across asset accounts, base currency. */
  accountAssets: number;
  /** Magnitude of liability accounts, base currency, positive. */
  liabilities: number;
  currency: string;
}) {
  const { t } = useI18n();

  // Labels come from the nav dictionary on purpose: a term reads with exactly
  // the same word as the sidebar entry it links to.
  const terms: Term[] = (
    [
      { href: "/analysis", label: t("nav.group.invest"), amount: investments, sign: "+" },
      { href: "/accounts", label: t("nav.accounts"), amount: accountAssets, sign: "+" },
      { href: "/accounts", label: t("nav.debt"), amount: liabilities, sign: "−" },
    ] as Term[]
  ).filter((term) => term.amount !== 0);

  // One term is not a composition, it is just the headline repeated.
  if (terms.length < 2) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
      <span className="text-zinc-500">{t("dash.madeUpOf")}</span>
      {terms.map((term, i) => (
        <span key={`${term.href}-${term.label}`} className="flex items-center gap-2">
          {i > 0 && <span className="text-zinc-400">{term.sign}</span>}
          <Link
            href={term.href}
            className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 dark:hover:bg-zinc-800 dark:focus-visible:outline-emerald-400"
          >
            <span className="text-zinc-500">{term.label}</span>
            <span
              className={`font-medium tabular-nums ${
                term.sign === "−" ? "text-red-600 dark:text-red-400" : ""
              }`}
              data-private=""
            >
              {formatCurrency(term.amount, currency)}
            </span>
          </Link>
        </span>
      ))}
    </div>
  );
}
