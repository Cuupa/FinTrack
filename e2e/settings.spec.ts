import { test, expect } from "@playwright/test";
import { openDashboard, addOtherAsset, dismissTour } from "./helpers";

// Settings mutates the profile through the store seam. Changing the base
// currency has to flow through the store into the reactive PortfolioData that
// the finance/format layer reads — visible on the dashboard hero, which
// re-renders on the new currency (the settings form itself seeds its inputs once
// at mount, so it is not the surface to assert reactivity on).
test.describe("settings (Guest Mode)", () => {
  test("changing base currency reformats the dashboard", async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, "Vienna Apartment", "300000");
    // Net worth starts in the default base currency (EUR, € symbol).
    await expect(page.getByText(/€/).first()).toBeVisible();

    // Switch base currency to USD in Settings and save.
    await page.goto("/settings");
    const currency = page.getByRole("button", { name: "Base currency" });
    await currency.click();
    await page.getByRole("option", { name: "USD" }).click();
    await expect(currency).toContainText("USD");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    // Back on the dashboard the hero is now formatted in USD ($).
    await page.goto("/");
    await dismissTour(page);
    await expect(page.getByText(/\$/).first()).toBeVisible();
  });
});
