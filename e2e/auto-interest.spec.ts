import { expect, test } from "@playwright/test";
import {
  dismissTour,
  openAddAccountModal,
  openBookings,
  openRecurring,
  submitAddAccountModal,
} from "./helpers";

// Interest on a liability posts on its own (owner rule): the lender charges it
// whatever the app thinks, so there is nothing to review. Credit interest on an
// asset account keeps its review, which is the second half of this spec.
//
// Only the wiring can show this: the booker is mounted globally, so the row has
// to appear on /spending without the user ever opening the review.

const LOAN = "E2E auto loan";
const SAVINGS = "E2E savings";

/** Rates on a liability are edited on /debt, not in the add form. */
async function setLoanRate(page: import("@playwright/test").Page, rate: string) {
  await page.goto("/debt");
  await dismissTour(page);
  await page
    .locator('[data-tour="debt-list"] tbody tr')
    .filter({ hasText: LOAN })
    .getByRole("button", { name: /^Edit$/i })
    .click();
  await page.locator("#account-edit-interest").fill(rate);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

test("a liability's interest books itself, an account's credit interest waits", async ({
  page,
}) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill(LOAN);
  await page.getByRole("dialog").getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Loan", exact: true }).click();
  await page.locator("#account-opening").fill("10000");
  await page.locator("#account-opened").fill("2024-01-01");
  await submitAddAccountModal(page);
  await expect(page.locator('[data-tour="accounts-list"]').getByText(LOAN)).toBeVisible();

  await setLoanRate(page, "12");

  // 12% a year on 10,000 is 100 a month, and it landed without a review. The
  // ledger is on the Bookings tab.
  await openBookings(page);
  const loanRow = page
    .locator('[data-tour="spending-table"]')
    .locator("tbody tr")
    .filter({ hasText: `Interest · ${LOAN}` });
  await expect(loanRow).toHaveCount(1);
  await expect(loanRow).toContainText("100");

  // The Recurring tab says it books itself and offers no review.
  await openRecurring(page);
  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card).toContainText("Booked automatically");
  await expect(card.getByRole("button", { name: "Review" })).toHaveCount(0);

  // It is booked once, not once per visit.
  await openBookings(page);
  await page.reload();
  await dismissTour(page);
  await expect(
    page
      .locator('[data-tour="spending-table"]')
      .locator("tbody tr")
      .filter({ hasText: `Interest · ${LOAN}` }),
  ).toHaveCount(1);

  // The other half of the rule: credit interest the user can reconcile against
  // a statement still asks first.
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill(SAVINGS);
  await page.getByRole("dialog").getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Savings", exact: true }).click();
  await page.locator("#account-opening").fill("10000");
  await page.locator("#account-opened").fill("2024-01-01");
  await page.locator("#account-interest").fill("12");
  await submitAddAccountModal(page);

  await openRecurring(page);
  await expect(
    page.locator('[data-tour="recurring-card"]').getByRole("button", { name: "Review" }),
  ).toBeVisible();

  await openBookings(page);
  await expect(
    page
      .locator('[data-tour="spending-table"]')
      .locator("tbody tr")
      .filter({ hasText: `Interest · ${SAVINGS}` }),
  ).toHaveCount(0);
});
