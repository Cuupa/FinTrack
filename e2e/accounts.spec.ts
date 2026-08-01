import { expect, test, type Page } from "@playwright/test";
import { dismissTour, openAddAccountModal, submitAddAccountModal } from "./helpers";

// Accounts (/accounts, flag `accounts`) in Guest Mode. Everything here is
// wiring the unit tests structurally cannot see: an amount typed with
// thousands separators has to survive the form, a wrong figure has to stay
// correctable after the fact (there was no edit surface at all, so a mortgage
// entered wrong could only be deleted and rebuilt), a booked balance has to
// move the listed figure, and an unparseable amount has to say so instead of
// leaving the button dead.

/** Add an account through the /accounts form (network-free). */
async function addAccount(
  page: Page,
  name: string,
  kind: string,
  opening: string,
): Promise<void> {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill(name);
  await page.getByRole("button", { name: "Type" }).click();
  // Not exact: every option carries an always-rendered (transparent) check
  // glyph, so the accessible name is "✓ Mortgage".
  await page.getByRole("option", { name: kind }).click();
  await page.locator("#account-opening").fill(opening);
  await submitAddAccountModal(page);
  await expect(page.locator('[data-tour="accounts-list"]').getByText(name)).toBeVisible();
}

function accountRow(page: Page, name: string) {
  return page.locator('[data-tour="accounts-list"] tbody tr').filter({ hasText: name });
}

test("a grouped amount keeps its magnitude", async ({ page }) => {
  // "250,000" (en grouping) used to reach the store as 250 — parseDecimal only
  // swapped the first comma for a dot, so a mortgage booked as 250 euros.
  await addAccount(page, "House mortgage", "Mortgage", "250,000");
  await expect(accountRow(page, "House mortgage")).toContainText("250,000");
});

test("an account's amount stays correctable after it was created", async ({ page }) => {
  await addAccount(page, "Car loan", "Loan", "20000");

  await accountRow(page, "Car loan").getByRole("button", { name: "Edit", exact: true }).click();
  const opening = page.locator("#account-edit-opening");
  await expect(opening).toHaveValue("20000");
  await opening.fill("17,500.50");
  await page.locator("#account-edit-name").fill("Car loan (refinanced)");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const row = accountRow(page, "Car loan (refinanced)");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("17,500.50");
});

test("a booked balance moves the listed figure", async ({ page }) => {
  await addAccount(page, "Savings pot", "Savings", "1000");

  await accountRow(page, "Savings pot").getByRole("button", { name: "Balances" }).click();
  await page.locator("#balance-value").fill("2,750.25");
  await page.getByRole("button", { name: "Add balance", exact: true }).click();
  // The reading is listed inside the dialog...
  await expect(page.getByRole("dialog").getByText("2,750.25")).toBeVisible();
  await page.keyboard.press("Escape");
  // ...and the latest reading, not the opening balance, is what the row shows.
  await expect(accountRow(page, "Savings pot")).toContainText("2,750.25");
});

test("an unparseable amount is reported instead of silently dropped", async ({ page }) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Broken input");
  await page.locator("#account-opening").fill("12.34.56");
  await submitAddAccountModal(page);

  await expect(page.getByText(/not a valid amount/i)).toBeVisible();
  await expect(page.locator('[data-tour="accounts-list"]').getByText("Broken input")).toHaveCount(0);
});
