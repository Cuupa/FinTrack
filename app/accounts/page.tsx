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

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AccountsSummary, AccountsChart } from "@/components/accounts/accounts-hero";
import { AccountsTable, AddAccountForm } from "@/components/accounts/accounts-view";
import { AccountsSkeleton } from "@/components/accounts/accounts-skeleton";
import { SpendingView } from "@/components/spending/spending-view";
import { RecurringCard } from "@/components/spending/recurring-card";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { Button, Card, PAGE_STACK } from "@/components/ui/primitives";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { MonthPicker } from "@/components/ui/month-picker";
import { Modal } from "@/components/ui/modal";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature, useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { Timeframe } from "@/lib/finance/dates";
import type { ChartScale } from "@/components/charts/performance-chart";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { PageScope } from "@/components/page-scope";
import { ACCOUNTS_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function AccountsPage() {
  // useSearchParams (the deep `?tab=` link from the old /spending route) needs a
  // Suspense boundary to prerender, same as /simulation's `?mode=`.
  return (
    <Suspense fallback={<AccountsSkeleton />}>
      <AccountsPageInner />
    </Suspense>
  );
}

function AccountsPageInner() {
  const { t } = useI18n();
  const { loading, loadError, reload, selectedAccountIds } = usePortfolio();
  const { enabled, locked } = useFeature("accounts");
  // The ledger keeps its own flag: merging the two surfaces must not hand a
  // user the bookings half that their plan or the flag never granted them.
  const spendingEnabled = useFeatureFlag("spending");

  // Empty = every account. The picker itself lives in the header next to the
  // depot's, so the selection comes from the portfolio context rather than
  // from this page's own state.
  const accountIds = selectedAccountIds;
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  // The page is split into tabs (spec §10.1): the accounts themselves, the
  // bookings against them, and what recurs -- instead of one long stack. The
  // bookings and recurring tabs only exist where the `spending` feature is on.
  // The initial tab honours a deep `?tab=` link (the old /spending route lands
  // on bookings), but only where that tab actually exists for this user.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<AccountsTab>(
    (requestedTab === "bookings" || requestedTab === "recurring") && spendingEnabled
      ? requestedTab
      : "accounts",
  );

  const ready = enabled && !locked && !loading && !loadError;

  const tabItems: TabItem<AccountsTab>[] = [
    { value: "accounts", label: t("accounts.tab.accounts") },
    ...(spendingEnabled
      ? ([
          { value: "bookings", label: t("accounts.tab.bookings") },
          { value: "recurring", label: t("accounts.tab.recurring") },
        ] as TabItem<AccountsTab>[])
      : []),
  ];

  return (
    <div className={PAGE_STACK}>
      <PageHeaderWithTour
        title={t("accounts.title")}
        subtitle={t("accounts.subtitle")}
        tourId="accounts"
        steps={ACCOUNTS_TOUR_STEPS}
        ready={ready}
        onActivateTab={(value) => setTab(value as AccountsTab)}
        availableTabs={tabItems.map((item) => item.value)}
        scope={ready ? <PageScope /> : undefined}
        actions={
          ready ? (
            <>
              <MonthPicker value={month} onChange={setMonth} />
              {/* Adding an account is the Konten tab's primary action; the
                  bookings tab carries its own "add booking" in the list header. */}
              {tab === "accounts" && (
                <Button
                  variant="primary"
                  size="sm"
                  className="shrink-0 whitespace-nowrap"
                  data-tour="add-account"
                  onClick={() => setAdding(true)}
                >
                  {t("accounts.form.add")}
                </Button>
              )}
            </>
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
          <Tabs items={tabItems} value={tab} onChange={setTab} />

          {tab === "accounts" && (
            <>
              <AccountsSummary accountIds={accountIds} timeframe={timeframe} month={month} />
              <AccountsTable selectedIds={accountIds} />
              <AccountsChart
                accountIds={accountIds}
                timeframe={timeframe}
                onTimeframe={setTimeframe}
                scale={scale}
                onScale={setScale}
                month={month}
              />
            </>
          )}

          {tab === "bookings" && spendingEnabled && (
            <SpendingView
              accountIds={accountIds}
              timeframe={timeframe}
              month={month}
              showRecurring={false}
            />
          )}

          {tab === "recurring" && spendingEnabled && <RecurringCard />}
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

type AccountsTab = "accounts" | "bookings" | "recurring";
