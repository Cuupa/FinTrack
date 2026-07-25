"use client";

// Desktop-only collapsible navigation sidebar (hidden below md, where the fixed
// bottom MobileNav takes over). Collapsed, it shows just the icons used by the
// mobile tab bar; expanded, icon + label. The collapsed state is persisted.
//
// Route metadata lives in lib/nav/routes.tsx, shared with MobileNav — this
// component owns the desktop layout of that list, not the list itself.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeatureFlags } from "@/lib/flags/flags-context";
import { NAV_ROUTES, hidesNavigation, isActiveRoute } from "@/lib/nav/routes";

const STORAGE_KEY = "fintrack:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { isEnabled } = useFeatureFlags();
  const [collapsed, setCollapsed] = useState(false);

  const visibleLinks = NAV_ROUTES.filter((l) => !l.flag || isEnabled(l.flag));

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

  if (hidesNavigation(pathname)) return null;

  return (
    <aside
      className={`sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 border-r border-zinc-200 md:block dark:border-zinc-800 ${
        collapsed ? "w-16" : "w-56"
      } transition-[width] duration-150`}
    >
      <nav data-tour="nav" className="flex h-full flex-col gap-1 p-2">
        {visibleLinks.map((l) => {
          const active = isActiveRoute(l.href, pathname);
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
