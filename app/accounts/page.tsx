"use client";

// Everyday money, one page (owner call, round 28): accounts and the bookings
// against them, shaped like /portfolio so the two halves of the product read
// the same way.
//
//   hero      -- the figure, the account picker, the timeframe, the curve
//   table     -- the accounts themselves
//   bookings  -- the entry mask, what recurs, and what has been booked
//
// The picker is the page's filter: choosing one account scopes the chart AND
// the ledger under it, which is what turns this from "a list of accounts" into
// "that account's statement". Stacked rather than side by side, because both
// lists are wide tables -- the depot stacks its holdings, plans and watchlist
// for the same reason.
//
// Adding an account sits behind a header button exactly like "add asset",
// instead of a permanent form card pushing the actual content down the page.

import { useState } from "react";

import { AccountsHero } from "@/components/accounts/accounts-hero";
import { AccountsTable, AddAccountForm } from "@/components/accounts/accounts-view";
import { AccountsSkeleton } from "@/components/accounts/accounts-skeleton";
import { SpendingView } from "@/components/spending/spending-view";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { Button, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature, useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { Timeframe } from "@/lib/finance/dates";
import type { ChartScale } from "@/components/charts/performance-chart";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { ACCOUNTS_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function AccountsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("accounts");
  // The ledger keeps its own flag: merging the two surfaces must not hand a
  // user the bookings half that their plan or the flag never granted them.
  const spendingEnabled = useFeatureFlag("spending");

  // Empty = every account. The picker is a multi-select, so the page's filter
  // is a list all the way down rather than an id plus a sentinel.
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [adding, setAdding] = useState(false);

  const ready = enabled && !locked && !loading && !loadError;

  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("accounts.title")}
        subtitle={t("accounts.subtitle")}
        tourId="accounts"
        steps={ACCOUNTS_TOUR_STEPS}
        ready={ready}
        actions={
          ready ? (
            <Button
              variant="primary"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              data-tour="add-account"
              onClick={() => setAdding(true)}
            >
              {t("accounts.form.add")}
            </Button>
          ) : undefined
        }
      />

      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <AccountsSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="accounts">
          <AccountsTable />
        </ProTeaser>
      ) : (
        <>
          <AccountsHero
            accountIds={accountIds}
            onAccounts={setAccountIds}
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            scale={scale}
            onScale={setScale}
          />
          <AccountsTable selectedIds={accountIds} />
          {spendingEnabled && <SpendingView accountIds={accountIds} timeframe={timeframe} />}
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} maxWidthClass="max-w-4xl">
        <Card>
          <AddAccountForm onDone={() => setAdding(false)} />
        </Card>
      </Modal>
    </div>
  );
}
