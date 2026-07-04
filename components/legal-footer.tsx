"use client";

// Discreet legal-links row shown at the bottom of the content area on every
// page (it lives inside <main> in app/layout.tsx, so it scrolls into view on
// mobile too, below the fixed MobileNav). Hidden on /shared — that's a
// read-only external view with its own minimal chrome (see SiteNav/Sidebar).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-context";

export function LegalFooter() {
  const pathname = usePathname();
  const { t } = useI18n();

  if (pathname.startsWith("/shared")) return null;

  return (
    <footer className="mx-auto mt-10 max-w-[1600px] border-t border-zinc-200 pt-4 pb-2 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
      <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
        <Link href="/impressum" className="hover:text-zinc-600 dark:hover:text-zinc-300">
          {t("legal.impressum")}
        </Link>
        <Link href="/datenschutz" className="hover:text-zinc-600 dark:hover:text-zinc-300">
          {t("legal.privacy")}
        </Link>
        <Link href="/terms" className="hover:text-zinc-600 dark:hover:text-zinc-300">
          {t("legal.terms")}
        </Link>
      </nav>
    </footer>
  );
}
