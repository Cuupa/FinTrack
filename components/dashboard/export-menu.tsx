"use client";

// Export the portfolio as CSV or JSON. A tiny dropdown next to "Add asset".

import { useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { exportPortfolioCsv, exportPortfolioJson } from "@/lib/export/export";
import { Button } from "@/components/ui/primitives";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export function ExportMenu() {
  const { data } = usePortfolio();
  const { t } = useI18n();
  const csvEnabled = useFeatureFlag("exportCsv");
  const jsonEnabled = useFeatureFlag("exportJson");
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

  if (!csvEnabled && !jsonEnabled) return null;

  const disabled = data.assets.length === 0 && data.transactions.length === 0;

  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        {t("export.menu")}
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {csvEnabled && (
            <button
              type="button"
              onClick={() => {
                exportPortfolioCsv(data);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t("export.csv")}
            </button>
          )}
          {jsonEnabled && (
            <button
              type="button"
              onClick={() => {
                exportPortfolioJson(data);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t("export.json")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
