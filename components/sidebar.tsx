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
  { href: "/analysis", key: "nav.analysis", icon: <path d="M4 19V5m0 14h16M8 16l3-4 3 2 4-6" /> },
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
      <nav className="flex h-full flex-col gap-1 p-2">
        {visibleLinks.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              title={collapsed ? t(l.key) : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
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
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200 ${
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
          {!collapsed && <span className="truncate">Collapse</span>}
        </button>
      </nav>
    </aside>
  );
}
