import { expect, test } from "@playwright/test";
import { dismissTour, openAddAccountModal, submitAddAccountModal } from "./helpers";

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
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Current account");
  await page.locator("#account-opening").fill("4000");
  await submitAddAccountModal(page);
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

// Return mode plots the depot's TWROR while the currency line plots net worth,
// so on the overview the two modes answer different questions. Only the wiring
// can show that the line renames itself and the note appears there and nowhere
// else -- and, with a mortgage seeded, that the window's change is the window's
// change and not the whole debt.
test("return mode says it measures the depot, and the change is not the debt", async ({
  page,
}) => {
  await page.goto("/accounts");
  await dismissTour(page);

  await openAddAccountModal(page);
  await page.getByRole("dialog").locator("#account-name").fill("Current account");
  await page.getByRole("dialog").locator("#account-opening").fill("4000");
  await submitAddAccountModal(page);

  await openAddAccountModal(page);
  const dialog = page.getByRole("dialog");
  await dialog.locator("#account-name").fill("House");
  await dialog.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Mortgage", exact: true }).click();
  await dialog.locator("#account-opening").fill("200000");
  await submitAddAccountModal(page);

  await page.goto("/");
  await dismissTour(page);
  const hero = page.locator('[data-tour="net-worth"]');
  const note = hero.getByText(/Return and risk figures cover the portfolio only/);

  // Net worth is -196,000 across the whole window. The chart's accessible
  // summary carries the window change, and with flat balances that change is
  // zero -- it must never be the entire net worth.
  await expect(hero).toContainText("196,000");
  const chart = hero.locator("[aria-label*='Net worth chart']");
  await expect(chart).toBeVisible();
  expect(await chart.getAttribute("aria-label")).not.toContain("196,000");

  await expect(note).toBeHidden();
  await hero.getByRole("button", { name: "Return", exact: true }).click();
  await expect(note).toBeVisible();

  // The depot page has nothing to disambiguate: no account is in its line.
  await page.goto("/portfolio");
  await dismissTour(page);
  const depotHero = page.locator('[data-tour="net-worth"]');
  await depotHero.getByRole("button", { name: "Return", exact: true }).click();
  await expect(
    depotHero.getByText(/Return and risk figures cover the portfolio only/),
  ).toBeHidden();
});
