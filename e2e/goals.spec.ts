import { expect, test, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

// Goals (/goals, flag `goals`) in Guest Mode. Rules the unit tests can't see
// because they live in the wiring: a goal needs no target date, a liability
// account shows up as a payoff goal without the user restating it as one, a
// goal built from sub-goals takes its target from their sum, and an existing
// goal's amount stays editable after it was created.

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

test("a goal made of sub-goals is worth the sum of its parts", async ({ page }) => {
  await page.goto("/goals");
  await dismissTour(page);

  /** Fill the add-goal form, optionally filing the goal under a parent. */
  async function addGoal(name: string, target: string, parent?: string) {
    await page.locator("#goal-name").fill(name);
    await page.locator("#goal-target").fill(target);
    if (parent) {
      await page.getByRole("button", { name: "Part of" }).click();
      // Not exact: options carry an always-rendered check glyph (see addLoan).
      await page.getByRole("option", { name: parent }).click();
    }
    await page.getByRole("button", { name: "Add goal", exact: true }).click();
  }

  // The parent's own target (1) is deliberately nonsense: once it has parts,
  // it is the sum of them that counts.
  await addGoal("Trip to the USA", "1");
  await addGoal("Flight", "800", "Trip to the USA");
  await addGoal("Hotel", "600", "Trip to the USA");

  const rows = page.locator('[data-tour="goals-list"] tbody tr');
  const trip = rows.filter({ hasText: "Trip to the USA" });
  await expect(trip).toContainText("Sum of its parts (2)");
  await expect(trip).toContainText("€1,400.00");

  // A sub-goal is offered as a part, never as a parent of its own.
  await page.getByRole("button", { name: "Part of" }).click();
  await expect(page.getByRole("option", { name: "Flight" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Deleting the whole goal takes its parts with it (store + DB cascade).
  await trip.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("its parts (2)");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(rows.filter({ hasText: "Flight" })).toHaveCount(0);
  await expect(rows.filter({ hasText: "Hotel" })).toHaveCount(0);
});

test("an existing goal's saved-up amount can be changed afterwards", async ({ page }) => {
  await page.goto("/goals");
  await dismissTour(page);

  await page.locator("#goal-name").fill("New bike");
  await page.locator("#goal-target").fill("1000");
  await page.locator("#goal-manual-current").fill("100");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();

  const row = page.locator('[data-tour="goals-list"] tbody tr').filter({ hasText: "New bike" });
  await expect(row).toContainText("€100.00 / €1,000.00");

  // The whole point: put more money aside later without recreating the goal.
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#goal-edit-target")).toHaveValue("1000");
  await dialog.locator("#goal-edit-manual-current").fill("450");
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("€450.00 / €1,000.00");
  // Persisted, not just re-rendered.
  await page.reload();
  await dismissTour(page);
  await expect(row).toContainText("€450.00 / €1,000.00");
});

test("a sub-goal on a liability does not swallow its derived payoff goal", async ({ page }) => {
  await addLoan(page, "Boat loan", "5000");

  await page.goto("/goals");
  await dismissTour(page);

  await page.locator("#goal-name").fill("Get debt-free");
  await page.locator("#goal-target").fill("1");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();

  // A part of that plan tracks the loan itself. Its progress is summed into
  // the parent, so the loan must keep its own derived row as well.
  await page.locator("#goal-name").fill("Boat repayment");
  await page.locator("#goal-target").fill("5000");
  await page.getByRole("button", { name: "Track progress with" }).click();
  await page.getByRole("option", { name: "Boat loan — pay off" }).click();
  await page.getByRole("button", { name: "Part of" }).click();
  await page.getByRole("option", { name: "Get debt-free" }).click();
  await page.getByRole("button", { name: "Add goal", exact: true }).click();

  const rows = page.locator('[data-tour="goals-list"] tbody tr');
  await expect(rows.filter({ hasText: "Boat repayment" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Automatic: paying off this liability" })).toHaveCount(1);
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
