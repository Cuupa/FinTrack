"use client";

// Persistent "not investment advice" notice (MiFID II / §34f GewO framing) for
// pages that surface simulated or model-derived figures (Monte Carlo, risk
// metrics). Always rendered — never dismissible, never a tooltip — so it's
// visible without any interaction. `full` mirrors the boxed "guideline" notes
// already used on the simulation page; `compact` is a single footnote line
// for pages where a full box would crowd the layout (still persistent and
// readable, just smaller).

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-context";

export function RiskDisclaimer({
  variant = "full",
  className = "",
}: {
  variant?: "full" | "compact";
  className?: string;
}) {
  const { t } = useI18n();

  if (variant === "compact") {
    return (
      <p
        className={`flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 ${className}`}
      >
        <span aria-hidden>ⓘ</span>
        <span>
          {t("disclaimer.short")}{" "}
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {t("legal.terms")}
          </Link>
          .
        </span>
      </p>
    );
  }

  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400 ${className}`}
    >
      <p className="font-medium text-zinc-700 dark:text-zinc-300">{t("disclaimer.title")}</p>
      <p className="mt-1">
        {t("disclaimer.body")} {t("disclaimer.more")}{" "}
        <Link
          href="/terms"
          className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {t("legal.terms")}
        </Link>
        .
      </p>
    </div>
  );
}
