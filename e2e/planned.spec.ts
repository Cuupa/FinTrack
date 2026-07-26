import { expect, test, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

// Planned income & expenses (/spending, flag `plannedCashflow`) in Guest Mode.
// What only the wiring can show: a planned salary whose first date lies in the
// past turns into a real ledger row after the review dialog (with the amount
// corrected there), and the forecast picks a one-off entry up for a later month.

/** Today minus `days`, as YYYY-MM-DD (same format as lib/finance/dates.ts). */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Add a checking account through the /accounts form (network-free). */
async function addChecking(page: Page, name: string) {
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill(name);
  await page.locator("#account-opening").fill("1000");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  // `.first()`: the kind column reads "Checking" too, so the name is not unique.
  await expect(page.locator('[data-tour="accounts-list"]').getByText(name).first()).toBeVisible();
}

test("a planned salary books into the ledger after review", async ({ page }) => {
  await addChecking(page, "Checking");

  await page.goto("/spending");
  await dismissTour(page);

  const card = page.locator('[data-tour="spending-planned"]');
  await expect(card).toContainText("Nothing planned yet");

  await card.locator("#planned-name").fill("Salary");
  await card.locator("#planned-amount").fill("2500");
  // A first date in the past makes the entry due right away.
  await card.locator("#planned-start").fill(daysAgo(3));
  await card.getByRole("button", { name: "Add planned entry", exact: true }).click();

  const row = card.locator("tbody tr").filter({ hasText: "Salary" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Monthly");

  // Review, correct the amount (a salary is rarely the planned figure), book.
  await card.getByRole("button", { name: /Book 1 due payment/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[inputmode="decimal"]').fill("2480");
  await dialog.getByRole("button", { name: "Book now", exact: true }).click();

  const ledger = page.locator('[data-tour="spending-table"]');
  const booked = ledger.locator("tbody tr").filter({ hasText: "Salary" });
  await expect(booked).toHaveCount(1);
  await expect(booked).toContainText("2,480");

  // Income totals reflect it, and the entry is no longer due.
  await expect(page.locator('[data-tour="spending-totals"]')).toContainText("2,480");
  await expect(card.getByRole("button", { name: /Book \d+ due payment/ })).toHaveCount(0);
});

test("a one-off planned expense shows up in the forecast", async ({ page }) => {
  await addChecking(page, "Checking");

  await page.goto("/spending");
  await dismissTour(page);

  const card = page.locator('[data-tour="spending-planned"]');
  await card.locator("#planned-name").fill("Holiday");
  await card.getByRole("button", { name: "Expense", exact: true }).click();
  await card.locator("#planned-amount").fill("1200");
  // Two weeks out: inside the six-month forecast window, never due.
  await card
    .locator("#planned-start")
    .fill(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  await card.getByRole("button", { name: "Interval" }).click();
  // Not exact: options carry an always-rendered check glyph.
  await page.getByRole("option", { name: /One-off/ }).click();
  await card.getByRole("button", { name: "Add planned entry", exact: true }).click();

  const row = card.locator("tbody tr").filter({ hasText: "Holiday" });
  await expect(row).toContainText("One-off");
  // A one-off has no monthly rate.
  await expect(row).toContainText("—");

  const forecast = page.locator('[data-tour="spending-forecast"]');
  await expect(forecast).toContainText("Planned expenses");
  await expect(forecast.locator("svg").first()).toBeVisible();
  // Nothing is due, so no booking button appeared on the planned card.
  await expect(card.getByRole("button", { name: /Book \d+ due payment/ })).toHaveCount(0);
});
