import { expect, test, type Page } from "@playwright/test";
import { bookTransaction, dismissTour, openAddAccountModal, submitAddAccountModal } from "./helpers";

// Accounts (/accounts, flag `accounts`) in Guest Mode. Everything here is
// wiring the unit tests structurally cannot see: an amount typed with
// thousands separators has to survive the form, an account's details have to
// stay correctable through the edit dialog, a booking has to move the listed
// figure (balances come from the journal now, not a hand-typed reading), and
// an unparseable amount has to say so instead of leaving the button dead.

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

test("an account's details stay correctable after it was created", async ({ page }) => {
  // The opening balance is set once, at creation; its details (name, kind,
  // rate) stay editable through the edit dialog, so a mortgage entered wrong no
  // longer has to be deleted and rebuilt.
  await addAccount(page, "Car loan", "Loan", "20000");

  await accountRow(page, "Car loan").getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#account-edit-name").fill("Car loan (refinanced)");
  await page.locator("#account-edit-interest").fill("4.5");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(accountRow(page, "Car loan (refinanced)")).toHaveCount(1);
});

test("a booking moves the listed figure", async ({ page }) => {
  // Balances come from the booking journal now: opening balance plus booked
  // transactions. Opened in the past so today's booking lands after the opening
  // anchor rather than being swallowed by it.
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Savings pot");
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Savings" }).click();
  await page.locator("#account-opening").fill("1000");
  await page.locator("#account-opened").fill("2020-01-01");
  await submitAddAccountModal(page);
  await expect(page.locator('[data-tour="accounts-list"]').getByText("Savings pot")).toBeVisible();

  // 1000 opening + 1750.25 in = 2750.25. Booking happens on the Bookings tab
  // (the entry mask lives there now); the balance shows on the accounts list.
  await bookTransaction(page, { type: "Income", payee: "Bonus", amount: "1750.25" });

  await page.goto("/accounts");
  await dismissTour(page);
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
