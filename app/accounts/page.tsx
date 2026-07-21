"use client";

import { AccountsView } from "@/components/accounts/accounts-view";
import { AccountsSkeleton } from "@/components/accounts/accounts-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function AccountsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const enabled = useFeatureFlag("accounts");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("accounts.title")}</h1>
        <p className="text-sm text-zinc-500">{t("accounts.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <AccountsSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <AccountsView />
      )}
    </div>
  );
}
