import { expect, test } from "@playwright/test";
import { dismissTour, openAddAccountModal, submitAddAccountModal } from "./helpers";

// /accounts absorbed /spending in round 28: one page for an account and the
// bookings against it, shaped like /portfolio. What only the wiring can show is
// that the account picker really is the page's filter rather than the chart's,
// and that the old route still lands somewhere.

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
  const form = page.locator('[data-tour="spending-form"]');
  await form.getByRole("button", { name: "Account" }).click();
  await page.getByRole("option", { name: account }).click();
  await form.locator("#spending-amount").fill(amount);
  await form.locator("#spending-payee").fill(payee);
  await form.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(form.locator("#spending-payee")).toHaveValue("");
}

test("the page carries accounts, what recurs and what was booked", async ({ page }) => {
  await addAccount(page, "Current account", "3000");

  const headings = page.locator("h2");
  await expect(headings.filter({ hasText: "Your accounts" })).toHaveCount(1);
  await expect(headings.filter({ hasText: "Recurring" })).toHaveCount(1);
  await expect(headings.filter({ hasText: "Bookings" })).toHaveCount(1);

  // The add-account form is behind the header button, not a permanent card.
  await expect(page.locator("#account-name")).toHaveCount(0);
});

test("the old spending route still lands on the merged page", async ({ page }) => {
  await page.goto("/spending");
  await dismissTour(page);
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Accounts");
});

test("picking accounts scopes the bookings under them", async ({ page }) => {
  await addAccount(page, "Current account", "3000");
  await addAccount(page, "Savings", "9000");
  await addAccount(page, "Cash", "200");

  await page.goto("/accounts");
  await dismissTour(page);
  await book(page, "Current account", "Netflix", "17.99");
  await book(page, "Savings", "Interest", "12");
  await book(page, "Cash", "Bakery", "4.20");

  const ledger = page.locator('[data-tour="spending-table"] tbody tr');
  const hero = page.locator('[data-tour="accounts-totals"]');
  const picker = page.getByRole("button", { name: "Which accounts to show" });
  await expect(ledger.filter({ hasText: "Netflix" })).toHaveCount(1);
  await expect(hero).toContainText("Net across all accounts");

  // Narrow to one account: the hero scope and the ledger both follow.
  await picker.click();
  await page.getByRole("option", { name: "Savings" }).click();

  await expect(hero).toContainText("Balance");
  await expect(ledger.filter({ hasText: "Interest" })).toHaveCount(1);
  await expect(ledger.filter({ hasText: "Netflix" })).toHaveCount(0);

  // The popover stays open in multi mode, so a second account is one more
  // click rather than a fresh trip through the picker.
  await page.getByRole("option", { name: "Current account" }).click();
  await expect(hero).toContainText("Net across the selected accounts");
  await expect(ledger.filter({ hasText: "Interest" })).toHaveCount(1);
  await expect(ledger.filter({ hasText: "Netflix" })).toHaveCount(1);
  // Still a filter, not "everything": the third account stays out.
  await expect(ledger.filter({ hasText: "Bakery" })).toHaveCount(0);
  await expect(picker).toContainText("2 selected");

  // And back to everything, without unticking each account by hand.
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await expect(ledger.filter({ hasText: "Bakery" })).toHaveCount(1);
  await expect(hero).toContainText("Net across all accounts");
});
