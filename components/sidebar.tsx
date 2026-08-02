"use client";

// Desktop-only collapsible navigation sidebar (hidden below md, where the fixed
// bottom MobileNav takes over). Collapsed, it shows just the icons used by the
// mobile tab bar; expanded, icon + label. The collapsed state is persisted.
//
// Route metadata lives in lib/nav/routes.tsx, shared with MobileNav — this
// component owns the desktop layout of that list, not the list itself.
//
// The list renders in the groups the registry declares. Flat, it was 14
// equally-weighted entries in the order the features happened to ship, which
// is what made the product read as a stack of unrelated tools; the group
// headings are the fix for that, so they are not decoration.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useAuth } from "@/lib/auth/auth-context";
import { useFeatureFlags } from "@/lib/flags/flags-context";
import { LockIcon } from "@/components/billing/pro-teaser";
import { ProfileMenu } from "@/components/profile-menu";
import { NotificationCount } from "@/components/ui/notification-count";
import { useNotifications } from "@/lib/notifications/use-notifications";
import {
  NAV_ROUTES,
  groupedRoutes,
  hidesNavigation,
  isActiveRoute,
  routeFeatureState,
  type NavRoute,
} from "@/lib/nav/routes";

const STORAGE_KEY = "fintrack:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { mode } = useAuth();
  const { getFeature } = useFeatureFlags();
  const { byRoute: pending } = useNotifications();
  const [collapsed, setCollapsed] = useState(false);

  // A Pro-locked route stays in the navigation and carries a padlock: the
  // paywall is a teaser, not a hidden feature, so the entry has to be
  // reachable for its blurred preview to be seen at all. Only a flag that is
  // off outright removes the entry (`enabled` is false then).
  const featureState = (r: NavRoute) => routeFeatureState(r, getFeature);
  const visibleLinks = NAV_ROUTES.filter((l) => featureState(l).enabled);
  const { ungrouped, sections } = groupedRoutes(visibleLinks);

  const renderLink = (l: NavRoute) => {
    const active = isActiveRoute(l.href, pathname);
    const locked = featureState(l).locked;
    const waiting = pending[l.href] ?? 0;
    return (
      <Link
        key={l.href}
        href={l.href}
        title={collapsed ? t(l.key) : undefined}
        aria-label={collapsed ? t(l.key) : undefined}
        aria-current={active ? "page" : undefined}
        className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400 ${
          collapsed ? "justify-center" : ""
        } ${
          active
            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
            : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
        }`}
      >
        <span className="relative flex shrink-0 items-center">
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
          {/* Collapsed there is no label to sit beside, so the count rides the
              icon — the rail is 64px wide and a pill would fill it. */}
          {collapsed && <NotificationCount count={waiting} overlay />}
        </span>
        {!collapsed && <span className="truncate">{t(l.key)}</span>}
        {!collapsed && waiting > 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            <NotificationCount count={waiting} />
            {locked && <LockIcon className="h-4 w-4 shrink-0 text-zinc-400" />}
          </span>
        )}
        {!collapsed && waiting === 0 && locked && (
          <LockIcon className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
        )}
      </Link>
    );
  };

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
      className={`sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r border-zinc-200 md:flex dark:border-zinc-800 ${
        collapsed ? "w-16" : "w-56"
      } transition-[width] duration-150`}
    >
      {/* Only the link list scrolls. The account row below sits outside it on
          purpose: its menu opens upward and out of the rail, which an
          `overflow-y-auto` ancestor would clip. */}
      <nav data-tour="nav" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {ungrouped.map(renderLink)}
        </div>

        {sections.map((section) => (
          <div
            key={section.id}
            // Spotlight target for the dashboard tour's per-group steps.
            data-tour={`nav-group-${section.id}`}
            className="mt-5 flex flex-col gap-1 first:mt-0"
          >
            {collapsed ? (
              // No room for a heading at 64px wide: a rule carries the same
              // "these belong together" signal without truncating a label.
              <hr className="mx-2 mb-2 border-zinc-200 dark:border-zinc-800" />
            ) : (
              <h2 className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
                {t(section.key)}
              </h2>
            )}
            {section.routes.map(renderLink)}
          </div>
        ))}

      </nav>

      {/* Pinned to the bottom edge of the rail, not merely the last list item:
          the account is where you leave the app from, not another destination
          in it. */}
      <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
        {mode === "registered" ? (
          <ProfileMenu variant="sidebar" collapsed={collapsed} />
        ) : (
          <Link
            href="/login"
            title={collapsed ? t("nav.login") : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100 dark:focus-visible:outline-emerald-400 ${
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
              className="h-5 w-5 shrink-0"
              aria-hidden="true"
            >
              <path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
            {!collapsed && <span className="truncate">{t("nav.login")}</span>}
          </Link>
        )}

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200 dark:focus-visible:outline-emerald-400 ${
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
      </div>
    </aside>
  );
}
