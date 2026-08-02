"use client";

// Round avatar (initials) for the signed-in user. Clicking it opens a menu with
// Settings and Logout. Replaces the email + standalone sign-out button.
//
// Two placements, one menu: `header` is the round avatar the top bar keeps
// below md (where there is no sidebar), `sidebar` is the full-width row pinned
// to the bottom of the desktop sidebar. The sidebar variant opens UPWARD —
// there is no room below it — which is why placement is a prop rather than a
// second component wrapping this one.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { exportPortfolioCsv, exportPortfolioJson, hasExportableData } from "@/lib/export/export";
import { useFeature } from "@/lib/flags/flags-context";
import { ProMenuItem } from "@/components/billing/pro-teaser";
import { useIsAdmin } from "@/lib/admin/use-is-admin";

function initials(name: string | null, email: string | null): string {
  const src = (name ?? "").trim() || (email ?? "").trim();
  if (!src) return "?";
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return src[0]!.toUpperCase();
}

export function ProfileMenu({
  variant = "header",
  collapsed = false,
}: {
  variant?: "header" | "sidebar";
  /** Sidebar variant only: the rail is 64px wide, so the row is icon-only. */
  collapsed?: boolean;
} = {}) {
  const { user, signOut } = useAuth();
  const { data } = usePortfolio();
  const { t } = useI18n();
  // Pro-locked formats stay listed as padlocked rows linking to /pricing.
  const csv = useFeature("exportCsv");
  const json = useFeature("exportJson");
  const csvEnabled = csv.enabled;
  const jsonEnabled = json.enabled;
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const name = data.profile.name;
  const email = user?.email ?? null;
  const exportDisabled = !hasExportableData(data);

  const inSidebar = variant === "sidebar";
  const avatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white dark:bg-emerald-500">
      {initials(name, email)}
    </span>
  );

  return (
    <div className="relative" ref={ref}>
      {inSidebar ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={collapsed ? (name ?? email ?? t("nav.account")) : undefined}
          aria-label={t("nav.account")}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-zinc-300 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100 dark:focus-visible:outline-emerald-400 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {avatar}
          {!collapsed && (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">{name ?? email ?? t("nav.account")}</span>
              {name && email && (
                <span className="block truncate text-xs text-zinc-400">{email}</span>
              )}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("nav.account")}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:bg-emerald-500"
        >
          {initials(name, email)}
        </button>
      )}
      {open && (
        <div
          className={`absolute z-30 w-56 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900 ${
            inSidebar ? "bottom-full left-0 mb-2" : "right-0 mt-2"
          }`}
        >
          {/* The expanded sidebar row already carries name + email; repeating
              them directly above it would be the same line twice. */}
          {!(inSidebar && !collapsed) && (
            <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
              {name && <div className="truncate text-sm font-medium">{name}</div>}
              <div className="truncate text-xs text-zinc-500">{email}</div>
            </div>
          )}
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {t("nav.settings")}
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t("admin.menuItem")}
            </Link>
          )}
          {(csvEnabled || jsonEnabled) && (
            <>
              <div className="border-t border-zinc-200 dark:border-zinc-800" />
              {csvEnabled &&
                (csv.locked ? (
                  <ProMenuItem label={t("export.csv")} />
                ) : (
                  <button
                    type="button"
                    disabled={exportDisabled}
                    onClick={() => {
                      exportPortfolioCsv(data);
                      setOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
                  >
                    {t("export.csv")}
                  </button>
                ))}
              {jsonEnabled &&
                (json.locked ? (
                  <ProMenuItem label={t("export.json")} />
                ) : (
                  <button
                    type="button"
                    disabled={exportDisabled}
                    onClick={() => {
                      exportPortfolioJson(data);
                      setOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
                  >
                    {t("export.json")}
                  </button>
                ))}
            </>
          )}
          <div className="border-t border-zinc-200 dark:border-zinc-800" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800"
          >
            {t("nav.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
