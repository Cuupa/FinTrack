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

test("changing a booked recurring payment asks which payments it applies to", async ({ page }) => {
  // An entry only books from an account, so there has to be one first.
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill("Current account");
  await page.locator("#account-opening").fill("2000");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(page.locator('[data-tour="accounts-list"]').getByText("Current account")).toBeVisible();

  await page.goto("/spending");
  await dismissTour(page);
  const card = page.locator('[data-tour="recurring-card"]');

  // A start date in the past makes the entry due right away, so it can be
  // booked and there is something for the change to apply to.
  await card.getByRole("button", { name: "Add recurring payment", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#contract-name").fill("Gym");
  await dialog.locator("#contract-amount").fill("30");
  await dialog.getByRole("button", { name: "Booking account" }).click();
  await page.getByRole("option", { name: "Current account" }).click();
  await dialog.locator("#contract-start").fill("2026-01-05");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await card.getByRole("button", { name: /^Book selected/ }).click();
  await expect(card.getByRole("button", { name: /^Book selected/ })).toHaveCount(0);

  // Inline edit on the row lands straight in the editor on its own page.
  await card
    .locator("tbody tr")
    .filter({ hasText: "Gym" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const editor = page.getByRole("dialog");
  await expect(editor.locator("#contract-amount")).toBeVisible();
  await editor.locator("#contract-amount").fill("45");
  await editor.getByRole("button", { name: "Save", exact: true }).click();

  // The question, and the answer that rewrites what was booked.
  const scope = page.getByRole("dialog").filter({ hasText: "Which payments does the change" });
  await expect(scope).toBeVisible();
  await scope.getByRole("button", { name: /Also the/ }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("tbody tr").filter({ hasText: "Gym" }).first()).toContainText("45");
});

test("a recurring entry's page links back to income & spending", async ({ page }) => {
  await page.goto("/spending");
  await dismissTour(page);
  const card = page.locator('[data-tour="recurring-card"]');
  await card.getByRole("button", { name: "Add recurring payment", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#contract-name").fill("Spotify");
  await dialog.locator("#contract-amount").fill("11");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await card.getByRole("link", { name: "Spotify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Spotify" })).toBeVisible();
  await page.getByRole("link", { name: /Back to income & spending/ }).click();
  await expect(page).toHaveURL(/\/spending$/);
});

test("the retired /contracts route is gone", async ({ page }) => {
  const res = await page.goto("/contracts");
  expect(res?.status()).toBe(404);
});
