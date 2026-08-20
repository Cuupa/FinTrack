import { expect, test, type Page } from "@playwright/test";
import { bookTransaction, dismissTour, openAddAccountModal, submitAddAccountModal } from "./helpers";

// Liabilities (/debt, flag `debtPayoff`) in Guest Mode. The wiring worth
// pinning is the payoff plan reacting to its two what-if levers: the extra
// monthly payment and the planned one-off repayments (Sondertilgungen). The
// lump-sum editor used to sit in the per-liability conditions dialog, where it
// read as a booked payment; it now belongs to the plan card, and the point of
// it is that the balance chart and "time to debt-free" visibly move.
//
// Nothing here is stored (owner rule): the lump sums are live what-if state,
// so a reload must forget them -- that is what the last test pins.

const MORTGAGE = "E2E mortgage";

/** Seed a liability with a rate and an instalment, so it enters the plan. */
async function seedMortgage(page: Page): Promise<void> {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill(MORTGAGE);
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Mortgage" }).click();
  await page.locator("#account-opening").fill("200000");
  await submitAddAccountModal(page);
  await expect(page.locator('[data-tour="accounts-list"]').getByText(MORTGAGE)).toBeVisible();

  await page.goto("/debt");
  await dismissTour(page);
  await page
    .locator('[data-tour="debt-list"] tbody tr')
    .filter({ hasText: MORTGAGE })
    .getByRole("button", { name: /^Edit$/i })
    .click();
  await page.locator("#account-edit-interest").fill("4");
  await page.locator("#account-edit-min-payment").fill("1200");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-tour="debt-plan"]')).toBeVisible();
}

/**
 * The lump-sum form moved into a dialog behind the "Add repayment" button
 * (spec §12.1): it no longer sits permanently in the plan card. Opens it, fills
 * date + amount, submits, and waits for the dialog to close.
 */
async function addRepayment(page: Page, date: string, amount: string): Promise<void> {
  await page.locator('[data-tour="debt-plan"]').getByRole("button", { name: /Add repayment/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#debt-repay-date").fill(date);
  await dialog.locator("#debt-repay-amount").fill(amount);
  await dialog.getByRole("button", { name: /Add repayment/i }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("a balance is read as repayment against the original loan sum", async ({ page }) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Old mortgage");
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Mortgage" }).click();
  await page.locator("#account-opening").fill("300000");
  await page.locator("#account-opened").fill("2019-04-01");
  await submitAddAccountModal(page);

  // Balances come from the journal now: an 82,000 repayment booked against the
  // mortgage takes the 300,000 opening down to 218,000 left.
  await bookTransaction(page, { type: "Income", payee: "Repayment", amount: "82000" });

  await page.goto("/debt");
  await dismissTour(page);
  const totals = page.locator('[data-tour="debt-totals"]');
  await expect(totals).toContainText("300,000");
  // 300,000 borrowed, 218,000 left: the gap is what has been repaid.
  await expect(totals).toContainText("82,000");

  // The chart only exists once the debt has a schedule to draw.
  await page
    .locator('[data-tour="debt-list"] tbody tr')
    .filter({ hasText: "Old mortgage" })
    .getByRole("button", { name: /^Edit$/i })
    .click();
  await page.locator("#account-edit-interest").fill("3.5");
  await page.locator("#account-edit-min-payment").fill("1400");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // And the chart reaches back to when the debt started, on the depot's own
  // timeframe strip, instead of starting at today.
  const chart = page.locator('[data-tour="debt-chart"]');
  await chart.getByRole("button", { name: "MAX", exact: true }).click();
  await expect(chart.getByText("2019")).toBeVisible();
});

test("a planned one-off repayment shortens the payoff plan", async ({ page }) => {
  await seedMortgage(page);

  const plan = page.locator('[data-tour="debt-plan"]');
  // "Time to debt-free" is stated ONCE, in the totals card -- the plan card
  // used to repeat it and the total interest verbatim.
  const timeToFree = page
    .locator('[data-tour="debt-totals"]')
    .getByText(/Time to debt-free/)
    .locator("../..");
  const before = (await timeToFree.textContent())!;

  await addRepayment(page, "2030-06-01", "40000");

  // It lands in the list of planned lump sums...
  await expect(plan.getByText("40,000")).toBeVisible();
  // ...the plan gets shorter...
  await expect.poll(async () => (await timeToFree.textContent())!).not.toBe(before);
  // ...and the saving versus minimum payments only is spelled out.
  await expect(plan.getByText(/saved versus minimum payments only/i)).toBeVisible();
});

test("the account form carries the terms and offers no repayments", async ({ page }) => {
  await seedMortgage(page);

  await page
    .locator('[data-tour="debt-list"] tbody tr')
    .filter({ hasText: MORTGAGE })
    .getByRole("button", { name: /^Edit$/i })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#account-edit-interest")).toBeVisible();
  await expect(dialog.locator("#debt-repay-amount")).toHaveCount(0);
});

test("a planned repayment can be removed again", async ({ page }) => {
  await seedMortgage(page);

  const plan = page.locator('[data-tour="debt-plan"]');
  await addRepayment(page, "2031-01-15", "15000");
  await expect(plan.getByText("15,000")).toBeVisible();

  await plan.getByRole("button", { name: /Remove repayment/i }).click();
  await expect(plan.getByText(/No one-off repayments planned yet/i)).toBeVisible();
});

test("planned repayments are live only and do not survive a reload", async ({ page }) => {
  await seedMortgage(page);

  const plan = page.locator('[data-tour="debt-plan"]');
  // Several at once: the point of the list is stacking more than one.
  await addRepayment(page, "2030-06-01", "40000");
  await addRepayment(page, "2032-06-01", "25000");
  await expect(plan.getByText("40,000")).toBeVisible();
  await expect(plan.getByText("25,000")).toBeVisible();

  await page.reload();
  await dismissTour(page);
  await expect(
    page.locator('[data-tour="debt-plan"]').getByText(/No one-off repayments planned yet/i),
  ).toBeVisible();
});
