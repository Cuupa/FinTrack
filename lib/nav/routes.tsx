// Single source of truth for primary navigation route metadata.
//
// Before this file the same 15 routes were declared in `components/sidebar.tsx`
// and (a hardcoded, unlocalized subset of) `components/mobile-nav.tsx`, so
// adding a route meant editing two registries and the mobile tab bar silently
// drifted behind the sidebar. Both now render from this list; the difference
// between them is layout, not content.
//
// The list is GROUPED, and that is the point of it rather than a cosmetic
// detail. Presented flat, the 14 routes were ordered by the date each feature
// shipped (dashboard, accounts, debt, spending, contracts, goals, health,
// fire, household, analysis, dividends, xray, rebalancing, simulation) — so
// the navigation read as a pile of tools bolted on one after another instead
// of one product. The groups below are the product's mental model: what you
// deal with day to day, what you have invested, and where you are headed.

import type { ReactNode } from "react";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import type { FeatureFlag } from "@/lib/flags/flags-context";

/** The areas of the product. The dashboard belongs to none of them: it is the
    home that summarises all three, so it sits above the first group header. */
export type NavGroup = "everyday" | "invest" | "plan";

export const NAV_GROUPS: { id: NavGroup; key: MessageKey }[] = [
  { id: "everyday", key: "nav.group.everyday" },
  { id: "invest", key: "nav.group.invest" },
  { id: "plan", key: "nav.group.plan" },
];

export type NavRoute = {
  href: string;
  /** Dictionary key for the label — never a literal string, the mobile tab
      bar regressed to English exactly because it inlined literals. */
  key: MessageKey;
  /** Children of a 24x24 stroke-only <svg>; the renderer supplies the frame. */
  icon: ReactNode;
  flag?: FeatureFlag;
  /** Candidate for the mobile tab bar, which only has room for a handful.
      Everything else stays reachable there through the "More" sheet. */
  primary?: boolean;
  /** Omitted only by the dashboard, which renders above every group header. */
  group?: NavGroup;
};

export const NAV_ROUTES: NavRoute[] = [
  {
    href: "/",
    key: "nav.dashboard",
    icon: <path d="M3 12l9-9 9 9M5 10v10h14V10" />,
    primary: true,
  },

  // Everyday money: the balances you hold, what flows out of them, and what
  // you owe. Household sits here because it shares exactly this.
  {
    href: "/accounts",
    key: "nav.accounts",
    // Wallet glyph: rounded card + clasp dot.
    icon: <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 4h18M16 14h.01" />,
    flag: "accounts",
    primary: true,
    group: "everyday",
  },
  // No /spending entry (round 28): accounts and the bookings against them are
  // one surface now, so a second tab pointing at the same cards would be the
  // duplication the merge removed. The route still exists and redirects.
  {
    href: "/cashflow",
    key: "nav.cashflow",
    // Trend glyph: rising line over an axis.
    icon: <path d="M4 19V5m0 14h16M7 15l4-5 3 3 5-6" />,
    // Same flag as /spending: the cards and the data are the same, and a flag
    // of its own would let the nav offer a page whose every card is a teaser.
    flag: "spending",
    primary: true,
    group: "everyday",
  },
  {
    href: "/debt",
    key: "nav.debt",
    // Downward trending bar chart glyph: paying a balance down over time.
    icon: <path d="M4 20h16M6 20V13l4 2 4-6 4 3v8" />,
    flag: "debtPayoff",
    group: "everyday",
  },
  {
    href: "/household",
    key: "nav.household",
    // Two-person glyph: shared/collaborative access.
    icon: <path d="M9 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 12v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 5a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-3.5-4.8" />,
    flag: "household",
    group: "everyday",
  },

  // Investments: everything that reads the transaction log rather than a
  // balance you typed in. `/portfolio` leads the group because it holds what
  // used to sit on the dashboard -- positions, savings plans, watchlist and
  // the depot chart -- which made the home screen read as a portfolio tracker
  // with everyday money bolted on.
  {
    href: "/portfolio",
    key: "nav.portfolio",
    // Stacked-holdings glyph: three bars of differing height in a frame.
    icon: <path d="M4 5h16v14H4zM8 15v-4M12 15V8M16 15v-6" />,
    primary: true,
    group: "invest",
  },
  {
    href: "/analysis",
    key: "nav.analysis",
    icon: <path d="M4 19V5m0 14h16M8 16l3-4 3 2 4-6" />,
    primary: true,
    group: "invest",
  },
  {
    href: "/dividends",
    key: "nav.dividends",
    // Coin/payout glyph: circle + € strokes.
    icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9.5A3.5 3.5 0 0 0 9 12a3.5 3.5 0 0 0 6 2.5M7.5 11h4m-4 2h4" />,
    flag: "dividends",
    group: "invest",
  },
  {
    href: "/xray",
    key: "nav.xray",
    icon: <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />,
    flag: "xray",
    group: "invest",
  },
  {
    href: "/rebalancing",
    key: "nav.rebalance",
    icon: <path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7zm10 0l-3 6a3 3 0 0 0 6 0l-3-6z" />,
    flag: "rebalance",
    group: "invest",
  },

  // Planning: where the current picture is headed, and how healthy it is.
  {
    href: "/goals",
    key: "nav.goals",
    // Target glyph: three concentric rings + center dot.
    icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />,
    flag: "goals",
    group: "plan",
  },
  {
    href: "/fire",
    key: "nav.fire",
    // Flag-on-a-pole glyph: reaching the goal.
    icon: <path d="M6 3v18M6 4h11l-3 4 3 4H6" />,
    flag: "firePlanner",
    group: "plan",
  },
  {
    href: "/pension",
    key: "nav.pension",
    // Seated-figure glyph: drawing a pension rather than earning a salary.
    icon: <path d="M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7 21v-4a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v4M4 21h16" />,
    flag: "pension",
    group: "plan",
  },
  {
    href: "/health",
    key: "nav.health",
    // Pulse glyph: heartbeat line through a circle.
    icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 12h3l1.5-4 3 8 1.5-4H18" />,
    flag: "finHealth",
    group: "plan",
  },
  {
    href: "/simulation",
    key: "nav.simulation",
    icon: <path d="M9 17V9m4 8V5m4 12v-6M4 21h16" />,
    flag: "simulation",
    group: "plan",
  },
];

/** A group paired with the routes of it that survived flag filtering. */
export type NavSection = { id: NavGroup; key: MessageKey; routes: NavRoute[] };

/**
 * Split an already flag-filtered route list into the dashboard-style
 * ungrouped head plus one section per group.
 *
 * Empty sections are dropped rather than rendered as a bare heading: with
 * every route in a group behind a feature flag, disabling all of them would
 * otherwise leave a "Planning" label floating above nothing.
 */
export function groupedRoutes(routes: NavRoute[]): {
  ungrouped: NavRoute[];
  sections: NavSection[];
} {
  return {
    ungrouped: routes.filter((r) => !r.group),
    sections: NAV_GROUPS.map(({ id, key }) => ({
      id,
      key,
      routes: routes.filter((r) => r.group === id),
    })).filter((s) => s.routes.length > 0),
  };
}

/** Active-route test shared by every renderer: "/" only matches itself,
    everything else matches its subtree (e.g. /accounts/x stays on Accounts). */
export function isActiveRoute(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Shared portfolios are a read-only external view of someone else's data:
    no app navigation at all. Each nav renderer used to inline this check. */
export function hidesNavigation(pathname: string): boolean {
  return pathname.startsWith("/shared");
}

/** Routes whose content is actually filtered by the selected portfolio. */
const PORTFOLIO_SCOPED = [
  "/portfolio",
  "/analysis",
  "/dividends",
  "/xray",
  "/rebalancing",
  "/simulation",
  "/assets",
  "/instruments",
];

/**
 * Whether the header's portfolio picker means anything on this route.
 *
 * A portfolio is a broker holding assets and transactions — those are the only
 * two entities carrying a `portfolioId`. Accounts, spending, contracts, goals,
 * debt and household are per-user, so the picker sitting above them scoped
 * nothing while implying the whole app lived inside a portfolio. That is a
 * large part of why the product still read as a portfolio tool with other
 * features attached.
 *
 * The dashboard no longer carries it. It used to, because the home screen WAS
 * the holdings table; now that positions live on /portfolio, a broker picker
 * in the header of a whole-net-worth overview would claim to scope figures
 * (accounts, spending, liabilities) that no portfolio has ever scoped.
 */
export function scopesToPortfolio(pathname: string): boolean {
  return PORTFOLIO_SCOPED.some((prefix) => pathname.startsWith(prefix));
}
