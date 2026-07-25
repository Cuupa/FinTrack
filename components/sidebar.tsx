"use client";

// Desktop-only collapsible navigation sidebar (hidden below md, where the fixed
// bottom MobileNav takes over). Collapsed, it shows just the icons used by the
// mobile tab bar; expanded, icon + label. The collapsed state is persisted.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import { useFeatureFlags, type FeatureFlag } from "@/lib/flags/flags-context";

const LINKS: { href: string; key: MessageKey; icon: ReactNode; flag?: FeatureFlag }[] = [
  { href: "/", key: "nav.dashboard", icon: <path d="M3 12l9-9 9 9M5 10v10h14V10" /> },
  {
    href: "/accounts",
    key: "nav.accounts",
    // Wallet glyph: rounded card + clasp dot.
    icon: <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 4h18M16 14h.01" />,
    flag: "accounts",
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
  { href: "/analysis", key: "nav.analysis", icon: <path d="M4 19V5m0 14h16M8 16l3-4 3 2 4-6" /> },
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

const STORAGE_KEY = "fintrack:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { isEnabled } = useFeatureFlags();
  const [collapsed, setCollapsed] = useState(false);

  const visibleLinks = LINKS.filter((l) => !l.flag || isEnabled(l.flag));

  useEffect(() => {
    // Deferred (async continuation) to satisfy the no-sync-setState-in-effect
    // rule and avoid an SSR/client hydration mismatch.
    void Promise.resolve().then(() =>
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1"),
    );
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  // Shared portfolios are a read-only external view — no app navigation.
  if (pathname.startsWith("/shared")) return null;

  return (
    <aside
      className={`sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 border-r border-zinc-200 md:block dark:border-zinc-800 ${
        collapsed ? "w-16" : "w-56"
      } transition-[width] duration-150`}
    >
      <nav data-tour="nav" className="flex h-full flex-col gap-1 p-2">
        {visibleLinks.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              title={collapsed ? t(l.key) : undefined}
              aria-label={collapsed ? t(l.key) : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400 ${
                collapsed ? "justify-center" : ""
              } ${
                active
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 shrink-0"
                aria-hidden="true"
              >
                {l.icon}
              </svg>
              {!collapsed && <span className="truncate">{t(l.key)}</span>}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          className={`mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200 dark:focus-visible:outline-emerald-400 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-5 w-5 shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {!collapsed && <span className="truncate">{t("nav.collapse")}</span>}
        </button>
      </nav>
    </aside>
  );
}
