"use client";

// Shown instead of a skeleton when `usePortfolio().loadError` is set (the
// store's load/reload failed, e.g. a Supabase query error) — the dashboard,
// asset detail and dividends pages all gate their skeleton on `loading`, so
// without this an unhandled load failure used to hang on the skeleton
// forever (TASK 66.2). Never rendered together with data loss: the
// portfolio context keeps whatever `data` it already had.

import { Card, Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Card>
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-zinc-500">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8 text-zinc-400"
          aria-hidden="true"
        >
          <path d="M12 9v4" />
          <path d="M12 16.5v.01" />
          <path d="M10.29 3.86l-8.19 14.2A1.5 1.5 0 0 0 3.5 20.5h17a1.5 1.5 0 0 0 1.4-2.44L13.71 3.86a1.5 1.5 0 0 0-2.42 0z" />
        </svg>
        <p className="font-medium text-zinc-700 dark:text-zinc-300">{t("common.loadError")}</p>
        <Button variant="primary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </div>
    </Card>
  );
}
