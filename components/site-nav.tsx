"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button } from "./ui/primitives";
import { PrivacyToggle } from "./privacy-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { ProfileMenu } from "./profile-menu";
import { PortfolioPicker } from "./portfolio-picker";

export function SiteNav() {
  const pathname = usePathname();
  const { mode } = useAuth();
  const { t } = useI18n();

  // A shared portfolio is a read-only view of someone else's data: no app
  // navigation, no privacy switcher — just a notice and a way back to the app.
  if (pathname.startsWith("/shared")) {
    return (
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <nav className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
          <span className="text-lg font-semibold tracking-tight">
            Fin<span className="text-emerald-600 dark:text-emerald-400">Track</span>
          </span>
          <span className="hidden items-center gap-1.5 text-sm text-zinc-500 sm:flex">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
            </svg>
            {t("shared.viewing")}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher />
            <Link href="/">
              <Button variant="primary">{t("shared.open")}</Button>
            </Link>
          </div>
        </nav>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <nav className="flex items-center gap-2 px-4 py-2.5 sm:gap-4">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
          Fin<span className="text-emerald-600 dark:text-emerald-400">Track</span>
        </Link>
        <PortfolioPicker />
        {/* Primary navigation lives in the sidebar (desktop) / MobileNav (mobile). */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
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
