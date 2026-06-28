"use client";

// Re-mounts the page subtree when the locale changes, so EVERY number/date —
// even in components that don't consume the i18n context — re-formats through
// the new locale (formatCurrency/formatDate read the active locale at call
// time). `display: contents` keeps it layout-transparent.

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";

export function LocaleBoundary({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  return (
    <div key={locale} className="contents">
      {children}
    </div>
  );
}
