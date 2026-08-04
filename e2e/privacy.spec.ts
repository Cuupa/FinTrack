import { expect, test } from "@playwright/test";

test.describe("Privacy mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Accounts & bookings" })).toBeVisible();
    const skipTour = page.getByRole("button", { name: "Skip tour" });
    if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
    await page.keyboard.press("Escape");
  });

  test("masks absolute figures across a page when toggled", async ({ page }) => {
    const toggle = page.getByRole("button", { name: "Hide figures" });
    await expect(page.locator("html")).not.toHaveClass(/incognito/);

    await toggle.click();

    await expect(page.locator("html")).toHaveClass(/incognito/);
    const privateValues = page.locator("[data-private]");
    await expect(privateValues.first()).toBeVisible();
    await expect(privateValues.first()).toHaveCSS("filter", /blur/);
    await expect(page.getByRole("button", { name: "Show figures" })).toBeVisible();
  });

  test("persists the masked state through a reload", async ({ page }) => {
    await page.getByRole("button", { name: "Hide figures" }).click();
    await page.reload();

    await expect(page.locator("html")).toHaveClass(/incognito/);
    await expect(page.locator("[data-private]").first()).toHaveCSS("filter", /blur/);
  });

  test("covers absolute pension figures as well", async ({ page }) => {
    await page.goto("/pension");
    await expect(page.getByRole("heading", { name: /Retirement|Rente/i }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Hide figures" }).click();

    const privateValues = page.locator("[data-private]");
    await expect(privateValues).not.toHaveCount(0);
    await expect(privateValues.first()).toHaveCSS("filter", /blur/);
  });
});
