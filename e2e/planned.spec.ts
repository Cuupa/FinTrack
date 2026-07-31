import { expect, test, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

// Planned income & expenses (flag `plannedCashflow`) in Guest Mode.
//
// The standalone "planned entries" card is gone: adding something that repeats
// is the same act as adding a booking, so it is the quick-add form's recurring
// toggle, and what it produces is reviewed and booked in the recurring card.
// These tests drive that surface -- the old ones drove a card no route renders
// any more and had been red ever since.

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

/** Fill the quick-add form with the recurring switch on. */
async function addRecurring(
  page: Page,
  { name, amount, date, income }: { name: string; amount: string; date: string; income?: boolean },
) {
  await page.goto("/spending");
  await dismissTour(page);
  if (income) await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.locator("#spending-recurring").click();
  await page.locator("#spending-amount").fill(amount);
  await page.locator("#spending-payee").fill(name);
  await page.locator("#spending-date").fill(date);
  await page.getByRole("button", { name: "Add recurring entry", exact: true }).click();
}

test("a planned salary books into the ledger after review", async ({ page }) => {
  await addChecking(page, "Checking");
  // A first date in the past makes the entry due right away.
  await addRecurring(page, { name: "Salary", amount: "2500", date: daysAgo(3), income: true });

  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card.locator("tbody tr").filter({ hasText: "Salary" })).toHaveCount(1);

  await card.getByRole("button", { name: /^Book selected/ }).click();

  const ledger = page.locator('[data-tour="spending-table"]');
  const booked = ledger.locator("tbody tr").filter({ hasText: "Salary" });
  await expect(booked).toHaveCount(1);
  await expect(booked).toContainText("2,500");
  // Nothing is due any more.
  await expect(card.getByRole("button", { name: /^Book selected/ })).toHaveCount(0);
});

test("a planned expense reaches the cash-flow forecast", async ({ page }) => {
  await addChecking(page, "Checking");
  // Two weeks out: inside the forecast window, never due.
  await addRecurring(page, {
    name: "Holiday",
    amount: "1200",
    date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  });

  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card.locator("tbody tr").filter({ hasText: "Holiday" })).toHaveCount(1);
  // Nothing due, so no review button.
  await expect(card.getByRole("button", { name: /^Book selected/ })).toHaveCount(0);

  // The forecast lives one page over and charts the planned entries as
  // aggregate lines (no per-entry labels), so what is assertable here is that
  // it renders with the entry in the data.
  await page.goto("/cashflow");
  await dismissTour(page);
  const forecast = page.locator('[data-tour="spending-forecast"]');
  await expect(forecast).toBeVisible();
  await expect(forecast.locator("svg").first()).toBeVisible();
});
