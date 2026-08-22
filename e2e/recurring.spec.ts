import { expect, test } from "@playwright/test";
import {
  dismissTour,
  openAddAccountModal,
  openBookings,
  openEntryMask,
  openRecurring,
  submitAddAccountModal,
} from "./helpers";

// Recurring payments (flag `contracts`) in Guest Mode, after the separate
// contract register was removed AND the card's own "add" button went with it:
// booking something and booking something that repeats are the same act, so the
// entry mask's "Recurring" switch is the only way in. The mask lives on the
// Bookings tab of the merged /accounts page, the recurring card on the
// Recurring tab (spec §10).
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

/** Adds a recurring entry through the switch on the entry mask (Bookings tab). */
async function addRecurring(
  page: import("@playwright/test").Page,
  name: string,
  amount: string,
  startDate?: string,
) {
  const form = await openEntryMask(page);
  await form.locator("#spending-recurring").click();
  await form.locator("#spending-amount").fill(amount);
  await form.locator("#spending-payee").fill(name);
  // The date field is a datetime-local; a date-only value is malformed.
  if (startDate) await form.locator("#spending-date").fill(`${startDate}T09:00`);
  await form.getByRole("button", { name: "Add recurring expense", exact: true }).click();
}

test("a recurring payment is added from the entry mask and deleted from the card", async ({
  page,
}) => {
  await seedAccount(page);
  await openRecurring(page);

  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card).toBeVisible();
  // The card no longer offers a second way in.
  await expect(card.getByRole("button", { name: "Add recurring payment" })).toHaveCount(0);

  await addRecurring(page, "Netflix", "17.99");

  await openRecurring(page);
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
  await openBookings(page);
  const card = page.locator('[data-tour="recurring-card"]');

  // Promoting a booking is the path that still produces a CONTRACT, which is
  // the entity that carries booked payments and therefore the scope question.
  const form = await openEntryMask(page);
  await form.locator("#spending-amount").fill("30");
  await form.locator("#spending-payee").fill("Gym");
  await form.locator("#spending-date").fill("2026-01-05T09:00");
  await form.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const ledger = page.locator('[data-tour="spending-table"]');
  await ledger
    .locator("tbody tr")
    .filter({ hasText: "Gym" })
    .getByRole("button", { name: "Add as recurring", exact: true })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Add as recurring" }).click();

  await openRecurring(page);
  await expect(card.locator("tbody tr").filter({ hasText: "Gym" })).toHaveCount(1);

  // The scope question lives on the entry's OWN page: the inline edit on the
  // card saves straight through, the detail-page editor is the one that asks.
  await card.locator("tbody tr").filter({ hasText: "Gym" }).getByRole("link", { name: "Gym" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gym" })).toBeVisible();
  // The editor is behind the header's Edit button (the row-level icons edit a
  // booked transaction, so .first() takes the header one).
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.locator("#contract-amount").fill("45");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The question, and the answer that rewrites what was booked.
  const scope = page.getByRole("dialog").filter({ hasText: "Which payments does the change" });
  await expect(scope).toBeVisible();
  await scope.getByRole("button", { name: /Also the/ }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("tbody tr").filter({ hasText: "Gym" }).first()).toContainText("45");
});

test("a recurring entry's page links back to accounts & bookings", async ({ page }) => {
  await seedAccount(page);
  await addRecurring(page, "Spotify", "11");
  await openRecurring(page);
  const card = page.locator('[data-tour="recurring-card"]');

  await card.getByRole("link", { name: "Spotify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Spotify" })).toBeVisible();
  // The back link (distinct from the sidebar nav entry) points at /spending,
  // which redirects onto the merged page's bookings tab.
  await page.getByRole("link", { name: "← Accounts & Bookings" }).click();
  await expect(page).toHaveURL(/\/accounts(\?|$)/);
});

test("the retired /contracts route is gone", async ({ page }) => {
  const res = await page.goto("/contracts");
  expect(res?.status()).toBe(404);
});

test("pausing a recurring entry stops its due bookings until it is resumed", async ({ page }) => {
  await seedAccount(page);

  // Backdated, so it is already due and the review notice shows its button.
  await addRecurring(page, "Gym", "30", "2024-01-15");
  await openRecurring(page);
  const card = page.locator('[data-tour="recurring-card"]');
  const row = card.locator("tbody tr").filter({ hasText: "Gym" }).first();
  await expect(card.getByRole("button", { name: "Review" })).toBeVisible();

  await row.getByRole("button", { name: "Pause" }).click({ force: true });
  await expect(row).toContainText("paused");
  await expect(card.getByRole("button", { name: "Review" })).toHaveCount(0);

  // Survives a reload: the pause is stored, not just view state.
  await page.reload();
  await dismissTour(page);
  const after = page.locator('[data-tour="recurring-card"] tbody tr').filter({ hasText: "Gym" }).first();
  await expect(after).toContainText("paused");

  await after.getByRole("button", { name: "Resume" }).click({ force: true });
  await expect(after).not.toContainText("paused");
  await expect(
    page.locator('[data-tour="recurring-card"]').getByRole("button", { name: "Review" }),
  ).toBeVisible();
});
