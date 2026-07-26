import { expect, test, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

// Goals (/goals, flag `goals`) in Guest Mode. Two rules the unit tests can't
// see because they live in the wiring: a goal needs no target date, and a
// liability account shows up as a payoff goal without the user restating it
// as one.

/** Add a liability account through the /accounts form (network-free). */
async function addLoan(page: Page, name: string, opening: string) {
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill(name);
  await page.getByRole("button", { name: "Type" }).click();
  // Not exact: every option carries an always-rendered (transparent) check
  // glyph, so the accessible name is "✓ Loan".
  await page.getByRole("option", { name: "Loan" }).click();
  await page.locator("#account-opening").fill(opening);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(page.locator('[data-tour="accounts-list"]').getByText(name)).toBeVisible();
}

test("a liability is listed as a payoff goal without being created by hand", async ({ page }) => {
  await addLoan(page, "Car loan", "20000");

  await page.goto("/goals");
  await dismissTour(page);

  const row = page.locator('[data-tour="goals-list"] tbody tr').filter({ hasText: "Car loan" });
  await expect(row).toHaveCount(1);
  // Marked as derived, and read-only: the account owns it, so no delete.
  await expect(row).toContainText("Automatic: paying off this liability");
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
  // No interest rate / minimum payment entered, so there is no honest date.
  await expect(row).toContainText("Open-ended");
});

test("a goal saves without a target date and reads as open-ended", async ({ page }) => {
  await page.goto("/goals");
  await dismissTour(page);

  await page.locator("#goal-name").fill("Emergency fund");
  await page.locator("#goal-target").fill("10000");
  // Target date deliberately left empty.
  await page.getByRole("button", { name: "Add goal", exact: true }).click();

  const row = page
    .locator('[data-tour="goals-list"] tbody tr')
    .filter({ hasText: "Emergency fund" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Open-ended");
  await expect(row.getByRole("button", { name: "Delete" })).toBeVisible();
});
