import { expect, test, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

// Liabilities (/debt, flag `debtPayoff`) in Guest Mode. The wiring worth
// pinning is the payoff plan reacting to its two what-if levers: the extra
// monthly payment and the planned one-off repayments (Sondertilgungen). The
// lump-sum editor used to sit in the per-liability conditions dialog, where it
// read as a booked payment; it now belongs to the plan card, and the point of
// it is that the balance chart and "time to debt-free" visibly move.

const MORTGAGE = "E2E mortgage";

/** Seed a liability with a rate and an instalment, so it enters the plan. */
async function seedMortgage(page: Page): Promise<void> {
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill(MORTGAGE);
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Mortgage" }).click();
  await page.locator("#account-opening").fill("200000");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(page.locator('[data-tour="accounts-list"]').getByText(MORTGAGE)).toBeVisible();

  await page.goto("/debt");
  await dismissTour(page);
  await page
    .locator('[data-tour="debt-list"] tbody tr')
    .filter({ hasText: MORTGAGE })
    .getByRole("button", { name: /Rate & payment/i })
    .click();
  await page.locator("#debt-rate").fill("4");
  await page.locator("#debt-min-payment").fill("1200");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-tour="debt-plan"]')).toBeVisible();
}

test("a planned one-off repayment shortens the payoff plan", async ({ page }) => {
  await seedMortgage(page);

  const plan = page.locator('[data-tour="debt-plan"]');
  // The Stat's root: label <span> -> label row -> Stat, so the value is included.
  const timeToFree = plan.getByText(/Time to debt-free/).locator("../..");
  const before = (await timeToFree.textContent())!;

  await plan.locator("#debt-repay-date").fill("2030-06-01");
  await plan.locator("#debt-repay-amount").fill("40000");
  await plan.getByRole("button", { name: /Add repayment/i }).click();

  // It lands in the list of planned lump sums...
  await expect(plan.getByText("40,000")).toBeVisible();
  // ...the plan gets shorter...
  await expect.poll(async () => (await timeToFree.textContent())!).not.toBe(before);
  // ...and the saving versus minimum payments only is spelled out.
  await expect(plan.getByText(/saved versus minimum payments only/i)).toBeVisible();
});

test("the conditions dialog no longer offers repayments", async ({ page }) => {
  await seedMortgage(page);

  await page
    .locator('[data-tour="debt-list"] tbody tr')
    .filter({ hasText: MORTGAGE })
    .getByRole("button", { name: /Rate & payment/i })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#debt-rate")).toBeVisible();
  await expect(dialog.locator("#debt-repay-amount")).toHaveCount(0);
});

test("a planned repayment can be removed again", async ({ page }) => {
  await seedMortgage(page);

  const plan = page.locator('[data-tour="debt-plan"]');
  await plan.locator("#debt-repay-date").fill("2031-01-15");
  await plan.locator("#debt-repay-amount").fill("15000");
  await plan.getByRole("button", { name: /Add repayment/i }).click();
  await expect(plan.getByText("15,000")).toBeVisible();

  await plan.getByRole("button", { name: /Remove repayment/i }).click();
  await expect(plan.getByText(/No one-off repayments planned yet/i)).toBeVisible();
});
