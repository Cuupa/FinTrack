import { expect, test } from "@playwright/test";
import { addOtherAsset, dismissTour } from "./helpers";

// Wiring the unit tests can't see: an asset account's rate actually growing its
// balance, a goal tracking one position, and the booking form's recurring
// switch flipping the form into "recurring entry" mode.

test("an asset account's interest rate grows its balance", async ({ page }) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill("Tagesgeld");
  await page.locator("#account-opening").fill("10000");
  await page.locator("#account-opened").fill("2024-01-01");
  await page.locator("#account-interest").fill("3");
  await page.getByRole("button", { name: "Add account", exact: true }).click();

  const row = page.locator("table tbody tr").first();
  await expect(row).toContainText("Tagesgeld");
  await expect(row).toContainText("3% p.a.");
  const balance = await row.locator("td").nth(2).innerText();
  expect(Number(balance.replace(/[^\d.]/g, ""))).toBeGreaterThan(10000);
});

test("a goal can track a single position", async ({ page }) => {
  await page.goto("/portfolio");
  await dismissTour(page);
  await addOtherAsset(page, "MetaTest", "1500");

  await page.goto("/goals");
  await dismissTour(page);
  await page.getByRole("button", { name: /Track progress with/i }).click();
  await page.getByRole("option", { name: /Position: MetaTest/i }).click();
  await page.locator("#goal-name").fill("Meta 2k");
  await page.locator("#goal-target").fill("2000");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();

  const row = page.locator("table tbody tr").first();
  await expect(row).toContainText("Position: MetaTest");
  await expect(row).toContainText("75%");
});

test("the recurring switch turns a booking into a recurring entry", async ({ page }) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await page.locator("#account-name").fill("Giro");
  await page.getByRole("button", { name: "Add account", exact: true }).click();

  await page.goto("/spending");
  await dismissTour(page);
  const toggle = page.getByRole("switch").first();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /Add recurring entry/i })).toBeVisible();
});
