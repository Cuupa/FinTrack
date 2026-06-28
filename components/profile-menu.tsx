"use client";

// Round avatar (initials) for the signed-in user. Clicking it opens a menu with
// Settings and Logout. Replaces the email + standalone sign-out button.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";

function initials(name: string | null, email: string | null): string {
  const src = (name ?? "").trim() || (email ?? "").trim();
  if (!src) return "?";
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return src[0]!.toUpperCase();
}

export function ProfileMenu() {
  const { user, signOut } = useAuth();
  const { data } = usePortfolio();
  const { t } = useI18n();
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:bg-emerald-500"
      >
        {initials(name, email)}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            {name && <div className="truncate text-sm font-medium">{name}</div>}
            <div className="truncate text-xs text-zinc-500">{email}</div>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {t("nav.settings")}
          </Link>
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
