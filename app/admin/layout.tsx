"use client";

// Gate for the entire /admin subtree. Renders nothing (and redirects home)
// for anyone but a verified admin: the real enforcement lives server-side
// (requireAdmin + RLS), this is purely a UX guard against flashing admin
// chrome at a non-admin user.

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useIsAdmin } from "@/lib/admin/use-is-admin";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useIsAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/");
  }, [loading, isAdmin, router]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div
          role="status"
          aria-label="Loading"
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
        />
      </div>
    );
  }

  if (!isAdmin) return null;

  const navItems = [
    { href: "/admin", label: t("admin.nav.overview") },
    { href: "/admin/flags", label: t("admin.nav.flags") },
    { href: "/admin/site", label: t("admin.nav.site") },
    { href: "/admin/prices", label: t("admin.nav.prices") },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              pathname === item.href
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
