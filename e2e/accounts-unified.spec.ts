import { expect, test } from "@playwright/test";
import {
  bookTransaction,
  dismissTour,
  openAddAccountModal,
  openBookings,
  submitAddAccountModal,
} from "./helpers";

// /accounts absorbed /spending (round 28) and now shapes it like /portfolio:
// one page, three tabs -- Accounts, Bookings, Recurring (spec §10). What only
// the wiring can show is that the account picker really is the page's filter
// rather than the chart's, and that the old route still lands somewhere.

async function addAccount(page: import("@playwright/test").Page, name: string, opening: string) {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill(name);
  await page.locator("#account-opening").fill(opening);
  await submitAddAccountModal(page);
  await expect(page.locator('[data-tour="accounts-list"]').getByText(name)).toBeVisible();
}

/** Books one expense against a named account through the entry mask. */
async function book(
  page: import("@playwright/test").Page,
  account: string,
  payee: string,
  amount: string,
) {
  await bookTransaction(page, { account, payee, amount });
}

test("the page carries accounts, bookings and recurring as tabs", async ({ page }) => {
  await addAccount(page, "Current account", "3000");

  // Three tabs on the merged page.
  await expect(page.getByRole("tab", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bookings" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Recurring" })).toBeVisible();

  // The accounts tab lists accounts; the add-account form is behind the header
  // button, not a permanent card.
  await expect(page.locator('[data-tour="accounts-list"]')).toBeVisible();
  await expect(page.locator("#account-name")).toHaveCount(0);

  // Each other tab renders its own surface.
  await page.getByRole("tab", { name: "Recurring" }).click();
  await expect(page.locator('[data-tour="recurring-card"]')).toBeVisible();

  await page.getByRole("tab", { name: "Bookings" }).click();
  await expect(page.locator('[data-tour="spending-table"]')).toBeVisible();
});

test("the old spending route still lands on the merged page", async ({ page }) => {
  await page.goto("/spending");
  await dismissTour(page);
  // It deep-links onto the bookings tab of the merged page.
  await expect(page).toHaveURL(/\/accounts\?tab=bookings/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Accounts");
});

test("picking accounts scopes the bookings under them", async ({ page }) => {
  await addAccount(page, "Current account", "3000");
  await addAccount(page, "Savings", "9000");
  await addAccount(page, "Cash", "200");

  await openBookings(page);
  await book(page, "Current account", "Netflix", "17.99");
  await book(page, "Savings", "Interest", "12");
  await book(page, "Cash", "Bakery", "4.20");

  // The account picker sits in the page header and scopes the bookings ledger.
  await openBookings(page);
  const ledger = page.locator('[data-tour="spending-table"] tbody tr');
  const picker = page.getByRole("button", { name: "Which accounts to show" });
  await expect(ledger.filter({ hasText: "Netflix" })).toHaveCount(1);

  // Narrow to one account: the ledger follows.
  await picker.click();
  await page.getByRole("option", { name: "Savings" }).click();
  await expect(ledger.filter({ hasText: "Interest" })).toHaveCount(1);
  await expect(ledger.filter({ hasText: "Netflix" })).toHaveCount(0);

  // The popover stays open in multi mode, so a second account is one more
  // click rather than a fresh trip through the picker.
  await page.getByRole("option", { name: "Current account" }).click();
  await expect(ledger.filter({ hasText: "Interest" })).toHaveCount(1);
  await expect(ledger.filter({ hasText: "Netflix" })).toHaveCount(1);
  // Still a filter, not "everything": the third account stays out.
  await expect(ledger.filter({ hasText: "Bakery" })).toHaveCount(0);
  await expect(picker).toContainText("2 selected");

  // And back to everything, without unticking each account by hand.
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await expect(ledger.filter({ hasText: "Bakery" })).toHaveCount(1);
});
