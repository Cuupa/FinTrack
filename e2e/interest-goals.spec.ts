import { expect, test } from "@playwright/test";
import {
  addOtherAsset,
  dismissTour,
  openAddAccountModal,
  openEntryMask,
  openRecurring,
  submitAddAccountModal,
} from "./helpers";

// Wiring the unit tests can't see: an asset account's rate actually growing its
// balance, a goal tracking one position, and the booking form's recurring
// switch flipping the form into "recurring entry" mode.

test("an asset account's booked interest grows its balance", async ({ page }) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Tagesgeld");
  await page.locator("#account-opening").fill("10000");
  await page.locator("#account-opened").fill("2024-01-01");
  await page.locator("#account-interest").fill("3");
  await submitAddAccountModal(page);

  await expect(
    page.locator('[data-tour="accounts-list"] tbody tr').filter({ hasText: "Tagesgeld" }),
  ).toContainText("3% p.a.");

  // Credit interest waits for review now (a liability's books itself); booking
  // the accrued interest is what finally moves the balance past 10,000. The
  // review is on the Recurring tab.
  await openRecurring(page);
  const card = page.locator('[data-tour="recurring-card"]');
  await card.getByRole("button", { name: "Review" }).click();
  await card.getByRole("button", { name: /^Book \d/ }).click();

  await page.goto("/accounts");
  await dismissTour(page);
  const row = page.locator('[data-tour="accounts-list"] tbody tr').filter({ hasText: "Tagesgeld" });
  const balance = await row.locator("td").nth(2).innerText();
  expect(Number(balance.replace(/[^\d.]/g, ""))).toBeGreaterThan(10000);
});

test("a goal can track a single position", async ({ page }) => {
  await page.goto("/portfolio");
  await dismissTour(page);
  await addOtherAsset(page, "MetaTest", "1500");

  await page.goto("/goals");
  await dismissTour(page);
  // The add form opens on demand now (§5.4), so open the modal first.
  await page.locator('[data-tour="goals-form"]').click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Track progress with/i }).click();
  // The picker groups holdings under "Positions"; the option itself is the bare
  // asset name, while the saved goal row reads "Position: MetaTest".
  await page.getByRole("option", { name: "MetaTest", exact: true }).click();
  await dialog.locator("#goal-name").fill("Meta 2k");
  await dialog.locator("#goal-target").fill("2000");
  await dialog.getByRole("button", { name: "Add goal", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.locator("table tbody tr").first();
  await expect(row).toContainText("Position: MetaTest");
  await expect(row).toContainText("75%");
});

test("the recurring switch turns a booking into a recurring entry", async ({ page }) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Giro");
  await submitAddAccountModal(page);

  await page.goto("/spending");
  await dismissTour(page);
  const form = await openEntryMask(page);
  const toggle = form.getByRole("switch").first();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(form.getByRole("button", { name: /Add recurring expense/i })).toBeVisible();
});
