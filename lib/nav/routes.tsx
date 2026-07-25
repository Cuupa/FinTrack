// Single source of truth for primary navigation route metadata.
//
// Before this file the same 15 routes were declared in `components/sidebar.tsx`
// and (a hardcoded, unlocalized subset of) `components/mobile-nav.tsx`, so
// adding a route meant editing two registries and the mobile tab bar silently
// drifted behind the sidebar. Both now render from this list; the difference
// between them is layout, not content.

import type { ReactNode } from "react";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import type { FeatureFlag } from "@/lib/flags/flags-context";

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
};

export const NAV_ROUTES: NavRoute[] = [
  {
    href: "/",
    key: "nav.dashboard",
    icon: <path d="M3 12l9-9 9 9M5 10v10h14V10" />,
    primary: true,
  },
  {
    href: "/accounts",
    key: "nav.accounts",
    // Wallet glyph: rounded card + clasp dot.
    icon: <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 4h18M16 14h.01" />,
    flag: "accounts",
    primary: true,
  },
  {
    href: "/debt",
    key: "nav.debt",
    // Downward trending bar chart glyph: paying a balance down over time.
    icon: <path d="M4 20h16M6 20V13l4 2 4-6 4 3v8" />,
    flag: "debtPayoff",
  },
  {
    href: "/spending",
    key: "nav.spending",
    // Receipt glyph: bordered rect + itemized lines.
    icon: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zm2 4h8M8 11h8M8 15h5" />,
    flag: "spending",
    primary: true,
  },
  {
    href: "/contracts",
    key: "nav.contracts",
    // Document glyph: bordered page + folded corner + signature line.
    icon: <path d="M6 3h9l3 3v15H6V3zm9 0v3h3M8 12h8M8 16h5" />,
    flag: "contracts",
  },
  {
    href: "/goals",
    key: "nav.goals",
    // Target glyph: three concentric rings + center dot.
    icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />,
    flag: "goals",
  },
  {
    href: "/health",
    key: "nav.health",
    // Pulse glyph: heartbeat line through a circle.
    icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 12h3l1.5-4 3 8 1.5-4H18" />,
    flag: "finHealth",
  },
  {
    href: "/fire",
    key: "nav.fire",
    // Flag-on-a-pole glyph: reaching the goal.
    icon: <path d="M6 3v18M6 4h11l-3 4 3 4H6" />,
    flag: "firePlanner",
  },
  {
    href: "/household",
    key: "nav.household",
    // Two-person glyph: shared/collaborative access.
    icon: <path d="M9 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 12v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 5a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-3.5-4.8" />,
    flag: "household",
  },
  {
    href: "/analysis",
    key: "nav.analysis",
    icon: <path d="M4 19V5m0 14h16M8 16l3-4 3 2 4-6" />,
    primary: true,
  },
  {
    href: "/dividends",
    key: "nav.dividends",
    // Coin/payout glyph: circle + € strokes.
    icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9.5A3.5 3.5 0 0 0 9 12a3.5 3.5 0 0 0 6 2.5M7.5 11h4m-4 2h4" />,
    flag: "dividends",
  },
  {
    href: "/xray",
    key: "nav.xray",
    icon: <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />,
    flag: "xray",
  },
  {
    href: "/rebalancing",
    key: "nav.rebalance",
    icon: <path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7zm10 0l-3 6a3 3 0 0 0 6 0l-3-6z" />,
    flag: "rebalance",
  },
  {
    href: "/simulation",
    key: "nav.simulation",
    icon: <path d="M9 17V9m4 8V5m4 12v-6M4 21h16" />,
    flag: "simulation",
  },
];

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
