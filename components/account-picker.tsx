"use client";

// Which accounts /accounts is scoped to, in the same header slot as the depot's
// `PortfolioPicker`: one filter, one place. An empty selection means every
// account, never a sentinel row that would tick like a real one.

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";

export function AccountPicker() {
  const { data, selectedAccountIds, setSelectedAccounts } = usePortfolio();
  const { t } = useI18n();
  const enabled = useFeatureFlag("accounts");

  if (!enabled || data.accounts.length === 0) return null;

  return (
    <SelectMenu
      multiple
      className="w-40 sm:w-56"
      ariaLabel={t("accounts.hero.pick")}
      value={selectedAccountIds}
      onChange={setSelectedAccounts}
      emptyLabel={t("accounts.hero.all")}
      searchable={data.accounts.length > 8}
      options={data.accounts.map((a) => ({ value: a.id, label: a.name }))}
    />
  );
}
