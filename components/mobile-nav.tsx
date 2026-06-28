"use client";

// Bottom tab bar shown only on small screens (md:hidden). Gives the installed
// PWA a native, thumb-reachable navigation. Mirrors the links in site-nav.tsx;
// the desktop header hides its inline links at the same breakpoint.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <path d="M3 12l9-9 9 9M5 10v10h14V10" />
    ),
  },
  {
    href: "/analysis",
    label: "Analysis",
    icon: <path d="M4 19V5m0 14h16M8 16l3-4 3 2 4-6" />,
  },
  {
    href: "/xray",
    label: "X-ray",
    icon: <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />,
  },
  {
    href: "/rebalancing",
    label: "Rebalance",
    icon: <path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7zm10 0l-3 6a3 3 0 0 0 6 0l-3-6z" />,
  },
  {
    href: "/simulation",
    label: "Simulation",
    icon: <path d="M9 17V9m4 8V5m4 12v-6M4 21h16" />,
  },
];

export function MobileNav() {
  const pathname = usePathname();

  // Shared portfolios are a read-only external view — no app navigation.
  if (pathname.startsWith("/shared")) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-[1600px]">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2 text-[10px] font-medium transition-colors ${
                active
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-500 dark:text-zinc-400"
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
                {tab.icon}
              </svg>
              <span className="max-w-full truncate">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
