import { expect, test } from "@playwright/test";
import { dismissTour } from "./helpers";

// The overview is not a depot report (owner call): four of the hero's six
// figures used to be securities-only, on a page that also answers for
// accounts, debt and spending. Two of them give way to the everyday-money
// pair, reusing /health's gauges.
//
// What only the wiring can show: the same component renders a DIFFERENT set
// depending on `investmentsOnly`, and the everyday figures are really derived
// from the ledger rather than rendered as placeholders.

async function seed(page: import("@playwright/test").Page) {
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill("Current account");
  await page.locator("#account-opening").fill("4000");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(
    page.locator('[data-tour="accounts-list"]').getByText("Current account"),
  ).toBeVisible();

  await page.goto("/spending");
  await dismissTour(page);
  const form = page.locator('[data-tour="spending-form"]');

  // 3000 in, 1200 out in one month -> a savings rate of exactly 60%.
  await form.getByRole("button", { name: "Income", exact: true }).click();
  await form.locator("#spending-amount").fill("3000");
  await form.locator("#spending-payee").fill("Salary");
  await form.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(form.locator("#spending-payee")).toHaveValue("");

  await form.getByRole("button", { name: "Expense", exact: true }).click();
  await form.locator("#spending-amount").fill("1200");
  await form.locator("#spending-payee").fill("Rent");
  await form.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(form.locator("#spending-payee")).toHaveValue("");
}

test("the overview leads with everyday money, the portfolio page with the depot", async ({
  page,
}) => {
  await seed(page);

  await page.goto("/");
  await dismissTour(page);
  const hero = page.locator('[data-tour="net-worth"]');
  await expect(hero).toContainText("Net worth");
  await expect(hero).toContainText("Savings rate");
  await expect(hero).toContainText("Months of expenses covered");
  // The depot-only pair belongs to /portfolio, not here.
  await expect(hero).not.toContainText("Unrealized P&L");

  // Derived from the ledger, not a placeholder: 3000 in, 1200 out.
  await expect(hero).toContainText("60");

  await page.goto("/portfolio");
  await dismissTour(page);
  const depotHero = page.locator('[data-tour="net-worth"]');
  await expect(depotHero).toContainText("Portfolio value");
  await expect(depotHero).toContainText("Unrealized P&L");
  await expect(depotHero).not.toContainText("Savings rate");
});
