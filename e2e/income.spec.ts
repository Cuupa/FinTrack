import { expect, test } from "@playwright/test";
import {
  bookTransaction,
  dismissTour,
  openAddAccountModal,
  openEntryMask,
  submitAddAccountModal,
} from "./helpers";

// Income is not a mirror of expense (owner report, round 27): the entry mask
// used to render identically for both, so a salary asked for a "payee" and
// offered "transfer to", and the ledger let you promote only expenses to a
// recurring entry.

async function seedAccount(page: import("@playwright/test").Page, name = "Current account") {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill(name);
  await page.locator("#account-opening").fill("3000");
  await submitAddAccountModal(page);
  await expect(page.locator('[data-tour="accounts-list"]').getByText(name)).toBeVisible();
}

/** Books one row through the entry mask. */
async function book(
  page: import("@playwright/test").Page,
  type: "Expense" | "Income",
  payee: string,
  amount: string,
) {
  await bookTransaction(page, { type, payee, amount });
}

test("the entry mask changes when you switch to income", async ({ page }) => {
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);
  const form = await openEntryMask(page);

  // Expense: a recipient, and the transfer target is on offer.
  await expect(form.getByText("Payee", { exact: true })).toBeVisible();
  await expect(form.getByText("Transfer to", { exact: true })).toBeVisible();

  await form.getByRole("button", { name: "Income", exact: true }).click();

  // Income: a source, and no transfer target -- money is arriving, so
  // "transfer TO another account" has no answer.
  await expect(form.getByText("Payer", { exact: true })).toBeVisible();
  await expect(form.getByText("Payee", { exact: true })).toHaveCount(0);
  await expect(form.getByText("Transfer to", { exact: true })).toHaveCount(0);
});

test("income can be promoted to a recurring entry, not just expenses", async ({ page }) => {
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);
  await book(page, "Income", "Salary", "3000");
  await book(page, "Expense", "Netflix", "17.99");

  const ledger = page.locator("tbody tr");
  const salary = ledger.filter({ hasText: "Salary" });
  const netflix = ledger.filter({ hasText: "Netflix" });

  // Both rows offer it, and as an icon like every other row action -- the
  // labelled text button was the one style break in this table.
  const action = { name: "Add as recurring", exact: true };
  await expect(salary.getByRole("button", action)).toHaveCount(1);
  await expect(netflix.getByRole("button", action)).toHaveCount(1);

  await salary.getByRole("button", action).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("recurring entry");
  await confirm.getByRole("button", action).click();

  // It lands in the merged recurring card, and the promoted row stops
  // offering the action a second time.
  const card = page.locator('[data-tour="recurring-card"]');
  const promoted = card.locator("tbody tr").filter({ hasText: "Salary" });
  await expect(promoted).toHaveCount(1);
  await expect(ledger.filter({ hasText: "Salary" }).getByRole("button", action)).toHaveCount(0);

  // "Goes to" answers the question the overview could not: this one is
  // credited, it does not move to another account and is not consumed.
  await expect(promoted).toContainText("Credited");
});

test("the recurring card says where the money ends up", async ({ page }) => {
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);
  await book(page, "Expense", "Netflix", "17.99");

  const row = page.locator("tbody tr").filter({ hasText: "Netflix" }).first();
  await row.getByRole("button", { name: "Add as recurring", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Add as recurring", exact: true })
    .click();

  // An expense with no transfer target leaves for good, and the column says so
  // rather than leaving the reader to guess.
  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card.locator("tbody tr").filter({ hasText: "Netflix" })).toContainText("Spent");
});

test("a recurring entry can be pinned to the last day of the month", async ({ page }) => {
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);

  const form = await openEntryMask(page);
  await form.locator("#spending-recurring").click();
  await form.locator("#spending-amount").fill("900");
  await form.locator("#spending-payee").fill("Rent");
  // Anchored mid-month on purpose: without the flag every occurrence would
  // keep landing on the 15th. The field is a datetime-local, so it needs a time.
  await form.locator("#spending-date").fill("2026-01-15T09:00");
  await form.getByRole("switch", { name: /last day of the month/i }).click();
  await form.getByRole("button", { name: "Add recurring entry", exact: true }).click();

  // The next due date is a month end, not the 15th it was started on.
  const row = page.locator('[data-tour="recurring-card"] tbody tr').filter({ hasText: "Rent" });
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText("15");

  // It survives a reload, so the flag reached the store rather than local state.
  await page.reload();
  await dismissTour(page);
  await expect(
    page.locator('[data-tour="recurring-card"] tbody tr').filter({ hasText: "Rent" }),
  ).toHaveCount(1);
});

test("promoting a transfer keeps its target account", async ({ page }) => {
  await seedAccount(page);
  await seedAccount(page, "Mortgage");

  await page.goto("/spending");
  await dismissTour(page);
  await bookTransaction(page, {
    payee: "Mortgage instalment",
    amount: "1035",
    transferTo: "Mortgage",
  });

  const row = page.locator("tbody tr").filter({ hasText: "Mortgage instalment" }).first();
  await row.getByRole("button", { name: "Add as recurring", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Add as recurring", exact: true })
    .click();

  // The promoted entry still moves money to the loan account. Nulling the
  // target here silently turned an instalment into a consumed expense, so it
  // stopped retiring the debt from the month it was promoted.
  const card = page.locator('[data-tour="recurring-card"]');
  const promoted = card.locator("tbody tr").filter({ hasText: "Mortgage instalment" });
  await expect(promoted).toContainText("Mortgage");
  await expect(promoted).not.toContainText("Spent");
});
