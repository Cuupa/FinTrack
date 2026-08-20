import { test, expect } from "@playwright/test";
import { openDashboard, addOtherAsset, dismissTour } from "./helpers";

// Savings plans ride the full store seam and derive due occurrences purely, but
// creating one through the dashboard card and seeing it land in the plan table
// is browser-only wiring.
test.describe("savings plans (Guest Mode)", () => {
  test("creating a plan adds it to the savings card", async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, "Vienna Apartment", "300000");

    // The savings-plans card moved to the Investments page's Savings plans tab.
    // addOtherAsset leaves us on /portfolio (Positions); the portfolio tour
    // auto-starts once a holding exists, so dismiss it before switching tabs.
    // The asset auto-selects the only holding, so amount is the one field to fill.
    await dismissTour(page);
    await page.getByRole("tab", { name: "Savings plans" }).click();
    await page.getByRole("button", { name: "+ New plan" }).click();
    await page.getByRole("button", { name: "Create plan" }).scrollIntoViewIfNeeded();

    // Amount is the sole free-text input in the plan form.
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create plan" }) });
    await form.getByRole("textbox").first().fill("500");
    await page.getByRole("button", { name: "Create plan" }).click();

    // The new plan shows up as a row referencing its asset.
    await expect(
      page.getByRole("button", { name: "+ New plan" }),
    ).toBeVisible(); // form closed → back to the card header
    await expect(page.getByText("Vienna Apartment").filter({ visible: true }).first()).toBeVisible();
  });
});
