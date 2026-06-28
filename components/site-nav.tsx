"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import { Button } from "./ui/primitives";
import { PrivacyToggle } from "./privacy-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { ProfileMenu } from "./profile-menu";

const LINKS: { href: string; key: MessageKey }[] = [
  { href: "/", key: "nav.dashboard" },
  { href: "/analysis", key: "nav.analysis" },
  { href: "/xray", key: "nav.xray" },
  { href: "/rebalancing", key: "nav.rebalance" },
  { href: "/simulation", key: "nav.simulation" },
];

export function SiteNav() {
  const pathname = usePathname();
  const { mode } = useAuth();
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Fin<span className="text-emerald-600 dark:text-emerald-400">Track</span>
        </Link>
        {/* Inline links are hidden on mobile; MobileNav renders a bottom tab bar instead. */}
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {t(l.key)}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <LocaleSwitcher />
          <PrivacyToggle />
          {mode === "registered" ? (
            <ProfileMenu />
          ) : (
            <>
              <Link href="/login">
                <Button variant="secondary">{t("nav.login")}</Button>
              </Link>
              <Link href="/login?tab=signup">
                <Button variant="primary">{t("nav.register")}</Button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
