"use client";

import { Suspense } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import { SettingsView } from "@/components/settings/settings-view";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { Card, PageHeader } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  const { t } = useI18n();
  // Wait for the store load before mounting the view: SettingsView seeds its
  // inputs (name, base currency, tax settings) once, at mount, from
  // `data.profile`. Mounting during load would seed the defaults and never
  // re-sync when the persisted profile arrives (mirrors the /rebalancing gate).
  const { loading } = usePortfolio();
  return (
    <div className="space-y-6">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      {loading ? (
        <Card>
          <Skeleton className="h-96 w-full" />
        </Card>
      ) : (
        // SettingsView reads `?tab=` via useSearchParams, which needs a Suspense
        // boundary for prerendering (same as /analysis and /retirement).
        <Suspense fallback={null}>
          <SettingsView />
        </Suspense>
      )}
    </div>
  );
}
