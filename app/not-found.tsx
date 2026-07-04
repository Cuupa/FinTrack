"use client";

// Rendered for any unmatched route. Sits inside the root layout/providers
// like a normal page, so i18n is available the same way it is everywhere else.

import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-10 w-10 text-zinc-400"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
        <path d="M8.5 11h5" />
      </svg>
      <p className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
        {t("notFound.title")}
      </p>
      <p className="max-w-md text-sm text-zinc-500">{t("notFound.body")}</p>
      <Link href="/">
        <Button variant="primary">{t("notFound.backHome")}</Button>
      </Link>
    </div>
  );
}
