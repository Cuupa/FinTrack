import { test, expect } from "@playwright/test";
import { openDashboard, addOtherAsset } from "./helpers";

// The Analysis page composes the allocation, returns and trades views over the
// derived holdings, each rendering Recharts charts. Tab switching + a chart
// actually mounting (role="img") is exactly the wiring unit tests skip.
test.describe("analysis (Guest Mode)", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, "Vienna Apartment", "300000");
    await addOtherAsset(page, "Art Collection", "80000");
  });

  test("distributions renders an allocation chart and tabs switch", async ({ page }) => {
    await page.getByRole("link", { name: /^Analysis$/ }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Analysis" })).toBeVisible();

    // Distributions is the default tab: a breakdown pill + a rendered pie.
    await expect(page.getByRole("button", { name: "Investments" })).toBeVisible();
    await expect(page.locator('[role="img"]').first()).toBeVisible();

    // Switch to Returns — the subtitle blurb tracks the active tab.
    await page.getByRole("button", { name: /^Returns$/ }).click();
    await expect(page.getByText(/contribution-adjusted returns by quarter/)).toBeVisible();

    // Switch to Trades.
    await page.getByRole("button", { name: /^Trades$/ }).click();
    await expect(page.getByText(/Realized P&L over time/)).toBeVisible();
  });
});
