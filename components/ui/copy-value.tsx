"use client";

// Small copy-to-clipboard affordance for read-only identifiers (ISIN/WKN/
// symbol). Renders the value/children as-is (callers keep their own classes)
// plus a button that copies `value` and briefly shows a check icon.

import { useState, type ReactNode, type MouseEvent } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";

export function CopyValue({
  value,
  children,
  className = "",
}: {
  value: string;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async (e: MouseEvent) => {
    // Guard against bubbling into a row/Link click when nested in a table row.
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this value:", value);
    }
  };

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {children ?? value}
      <button
        type="button"
        onClick={copy}
        aria-label={t("common.copy")}
        title={t("common.copy")}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors ${
          copied
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        }`}
      >
        {copied ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </span>
  );
}
