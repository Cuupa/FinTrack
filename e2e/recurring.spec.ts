import { expect, test } from "@playwright/test";
import { dismissTour, openAddAccountModal, submitAddAccountModal } from "./helpers";

// Recurring payments (/spending, flag `contracts`) in Guest Mode, after the
// separate contract register was removed AND the card's own "add" button went
// with it: booking something and booking something that repeats are the same
// act, so the entry mask's "Recurring" switch is the only way in.
//
// What only the wiring can show: the switch reaches the store, the merged list
// and its delete confirmation work from this one card, promoting a booking
// still produces a real contract, and the old route is gone rather than
// merely unlinked.

/** The entry mask only offers itself once there is an account to book from. */
async function seedAccount(page: import("@playwright/test").Page, name = "Current account") {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill(name);
  await page.locator("#account-opening").fill("2000");
  await submitAddAccountModal(page);
  await expect(page.locator('[data-tour="accounts-list"]').getByText(name)).toBeVisible();
}

/** Adds a recurring entry through the switch on the entry mask. */
async function addRecurring(
  page: import("@playwright/test").Page,
  name: string,
  amount: string,
  startDate?: string,
) {
  const form = page.locator('[data-tour="spending-form"]');
  await form.locator("#spending-recurring").click();
  await form.locator("#spending-amount").fill(amount);
  await form.locator("#spending-payee").fill(name);
  if (startDate) await form.locator("#spending-date").fill(startDate);
  await form.getByRole("button", { name: "Add recurring entry", exact: true }).click();
}

test("a recurring payment is added from the entry mask and deleted from the card", async ({
  page,
}) => {
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);

  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card).toBeVisible();
  // The card no longer offers a second way in.
  await expect(card.getByRole("button", { name: "Add recurring payment" })).toHaveCount(0);

  await addRecurring(page, "Netflix", "17.99");

  const row = card.locator("tbody tr").filter({ hasText: "Netflix" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Monthly");

  // It survives a reload: the switch wrote through the store, not local state.
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
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);
  const card = page.locator('[data-tour="recurring-card"]');

  // Promoting a booking is the path that still produces a CONTRACT, which is
  // the entity that carries booked payments and therefore the scope question.
  const form = page.locator('[data-tour="spending-form"]');
  await form.locator("#spending-amount").fill("30");
  await form.locator("#spending-payee").fill("Gym");
  await form.locator("#spending-date").fill("2026-01-05");
  await form.getByRole("button", { name: "Add transaction", exact: true }).click();

  const ledger = page.locator('[data-tour="spending-table"]');
  await ledger
    .locator("tbody tr")
    .filter({ hasText: "Gym" })
    .getByRole("button", { name: "Add as recurring", exact: true })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Add as recurring" }).click();

  await expect(card.locator("tbody tr").filter({ hasText: "Gym" })).toHaveCount(1);

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
  await seedAccount(page);
  await page.goto("/spending");
  await dismissTour(page);
  const card = page.locator('[data-tour="recurring-card"]');

  await addRecurring(page, "Spotify", "11");

  await card.getByRole("link", { name: "Spotify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Spotify" })).toBeVisible();
  await page.getByRole("link", { name: /Back to income & spending/ }).click();
  await expect(page).toHaveURL(/\/spending$/);
});

test("the retired /contracts route is gone", async ({ page }) => {
  const res = await page.goto("/contracts");
  expect(res?.status()).toBe(404);
});
