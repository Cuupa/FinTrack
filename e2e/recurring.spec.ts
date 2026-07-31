import { expect, test } from "@playwright/test";
import { dismissTour } from "./helpers";

// Recurring payments (/spending, flag `contracts`) in Guest Mode, after the
// separate contract register was removed. What only the wiring can show: the
// add dialog, the list and the delete confirmation all reach the store from
// this one card, and the old route is really gone rather than merely unlinked.

test("a recurring payment is added and deleted from the spending card", async ({ page }) => {
  await page.goto("/spending");
  await dismissTour(page);

  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Add recurring payment", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.locator("#contract-name").fill("Netflix");
  await dialog.locator("#contract-amount").fill("17.99");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  const row = card.locator("tbody tr").filter({ hasText: "Netflix" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Monthly");

  // It survives a reload: the card wrote through the store, not local state.
  await page.reload();
  await dismissTour(page);
  await expect(card.locator("tbody tr").filter({ hasText: "Netflix" })).toHaveCount(1);

  // Destructive actions confirm first (repo rule).
  await card
    .locator("tbody tr")
    .filter({ hasText: "Netflix" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete recurring payment");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(card.locator("tbody tr").filter({ hasText: "Netflix" })).toHaveCount(0);
});

test("the retired /contracts route is gone", async ({ page }) => {
  const res = await page.goto("/contracts");
  expect(res?.status()).toBe(404);
});
