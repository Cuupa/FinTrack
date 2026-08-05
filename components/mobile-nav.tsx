"use client";

// Bottom tab bar shown only on small screens (md:hidden). Gives the installed
// PWA a native, thumb-reachable navigation.
//
// Route metadata comes from lib/nav/routes.tsx, shared with the desktop
// Sidebar. A tab bar only fits a handful of targets, so the routes marked
// `primary` get a tab and everything else lives behind "More" — previously
// this component carried its own five-entry copy of the list with hardcoded
// English labels, which left 10 shipped routes unreachable on mobile and
// showed an English tab bar to de/es users.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeatureFlags } from "@/lib/flags/flags-context";
import { LockIcon } from "@/components/billing/pro-teaser";
import { useFocusTrap } from "./ui/use-focus-trap";
import {
  NAV_ROUTES,
  groupedRoutes,
  hidesNavigation,
  isActiveRoute,
  type NavRoute,
} from "@/lib/nav/routes";

/** Tabs that fit across a phone without the labels truncating, "More"
    included. Primary routes past this budget fall into the sheet. */
const TAB_BUDGET = 4;

function NavIcon({ children, className }: { children: ReactNode; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { getFeature } = useFeatureFlags();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Same rule as the sidebar: a Pro-locked route stays visible (its page
  // shows the blurred teaser), only an off flag removes the entry.
  const featureState = (r: NavRoute) =>
    r.flag ? getFeature(r.flag) : { enabled: true, locked: false };
  const visible = NAV_ROUTES.filter((r) => featureState(r).enabled);
  const tabs = visible.filter((r) => r.primary).slice(0, TAB_BUDGET);
  const rest = visible.filter((r) => !tabs.includes(r));

  // Navigating away closes the sheet: the Links inside it change the route
  // without unmounting this component.
  useEffect(() => {
    void Promise.resolve().then(() => setSheetOpen(false));
  }, [pathname]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  useFocusTrap(sheetRef, sheetOpen);

  if (hidesNavigation(pathname)) return null;

  const inSheet = rest.some((r) => isActiveRoute(r.href, pathname));

  const { ungrouped: restUngrouped, sections: restSections } = groupedRoutes(rest);

  const renderSheetLink = (route: NavRoute) => {
    const active = isActiveRoute(route.href, pathname);
    return (
      <Link
        key={route.href}
        href={route.href}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
          active
            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
            : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
        }`}
      >
        <NavIcon className="h-5 w-5 shrink-0">{route.icon}</NavIcon>
        <span className="truncate">{t(route.key)}</span>
        {featureState(route).locked && (
          <LockIcon className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
        )}
      </Link>
    );
  };

  const tabCls = (active: boolean) =>
    `flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400 ${
      active ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"
    }`;

  return (
    <>
      {sheetOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.more")}
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-lg border-t border-zinc-200 bg-white outline-none dark:border-zinc-800 dark:bg-zinc-900"
            // Clears the tab bar this sheet sits above, plus the home indicator.
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-base font-semibold">{t("nav.more")}</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label={t("common.close")}
                className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            {/* Grouped exactly like the desktop sidebar. This sheet holds most
                of the app on a phone, so an ungrouped run of 10 links is the
                same "pile of features" problem in a smaller frame. */}
            <nav className="flex flex-col px-2 pb-2">
              {restUngrouped.length > 0 && (
                <div className="flex flex-col gap-0.5">{restUngrouped.map(renderSheetLink)}</div>
              )}
              {restSections.map((section) => (
                <div key={section.id} className="mt-4 flex flex-col gap-0.5 first:mt-0">
                  <h3 className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
                    {t(section.key)}
                  </h3>
                  {section.routes.map(renderSheetLink)}
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}

      <nav
        className="ft-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-[1600px]">
          {tabs.map((route) => {
            const active = isActiveRoute(route.href, pathname);
            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={active ? "page" : undefined}
                className={tabCls(active)}
              >
                <NavIcon className="h-5 w-5 shrink-0">{route.icon}</NavIcon>
                <span className="max-w-full truncate">{t(route.key)}</span>
              </Link>
            );
          })}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setSheetOpen((o) => !o)}
              aria-expanded={sheetOpen}
              // A route reachable only through the sheet still counts as
              // "you are here", so More lights up with it.
              aria-current={inSheet ? "page" : undefined}
              className={tabCls(sheetOpen || inSheet)}
            >
              <NavIcon className="h-5 w-5 shrink-0">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </NavIcon>
              <span className="max-w-full truncate">{t("nav.more")}</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
