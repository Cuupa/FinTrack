import { expect, test } from "@playwright/test";
import { dismissTour } from "./helpers";

// Income is not a mirror of expense (owner report, round 27): the entry mask
// used to render identically for both, so a salary asked for a "payee" and
// offered "transfer to", and the ledger let you promote only expenses to a
// recurring entry.

async function seedAccount(page: import("@playwright/test").Page, name = "Current account") {
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill(name);
  await page.locator("#account-opening").fill("3000");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(page.locator('[data-tour="accounts-list"]').getByText(name)).toBeVisible();
}

/** Books one row through the entry mask. */
async function book(
  page: import("@playwright/test").Page,
  type: "Expense" | "Income",
  payee: string,
  amount: string,
) {
  const form = page.locator('[data-tour="spending-form"]');
  await form.getByRole("button", { name: type, exact: true }).click();
  await form.locator("#spending-amount").fill(amount);
  await form.locator("#spending-payee").fill(payee);
  await form.getByRole("button", { name: "Add transaction", exact: true }).click();
}

test("the entry mask changes when you switch to income", async ({ page }) => {
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);
  const form = page.locator('[data-tour="spending-form"]');

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
  await expect(card.locator("tbody tr").filter({ hasText: "Salary" })).toHaveCount(1);
  await expect(ledger.filter({ hasText: "Salary" }).getByRole("button", action)).toHaveCount(0);
});
