import { test, expect } from "@playwright/test";
import { openDashboard, addOtherAsset, openAssetDetail } from "./helpers";

// The asset-detail page is the busiest client surface: it derives position/P&L
// from the transaction log, renders the price chart, and hosts the valuation,
// transaction and tags editors — all through the store seam. These flows are the
// integration this suite exists to cover.
test.describe("asset detail (Guest Mode)", () => {
  const NAME = "Vienna Apartment";

  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, NAME, "300000");
    await openAssetDetail(page, NAME);
  });

  test("renders the detail page with its core sections", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Valuation" })).toBeVisible();
  });

  test("adding a valuation point updates the current value", async ({ page }) => {
    // The opening point is dated today; a same-date point replaces it and
    // becomes the current manual valuation.
    await page.locator("#valuation-date").fill("2026-07-20");
    await page.locator("#valuation-value").fill("345000");
    await page.getByRole("button", { name: "Add valuation" }).click();
    // The "Current value: …" line (colon disambiguates it from the tooltip)
    // reflects the new number (grouped 345,000).
    await expect(page.getByText(/Current value: .*345[.,]000/)).toBeVisible();
  });

  test("adding a buy transaction appends to the transaction log", async ({ page }) => {
    const txTable = page
      .getByRole("heading", { name: "Transactions" })
      .locator("xpath=following::table[1]");
    await expect(txTable.locator("tbody tr")).toHaveCount(1); // the opening tx

    // The transaction form defaults to BUY; fill quantity + price and submit.
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^Add buy$/ }) });
    await form.getByRole("textbox").nth(0).fill("2"); // quantity (placeholder "0")
    await form.getByRole("textbox").nth(1).fill("100"); // price
    await form.getByRole("button", { name: /^Add buy$/ }).click();

    await expect(txTable.locator("tbody tr")).toHaveCount(2);
  });

  test("creating a tag group and assigning a value shows the tag", async ({ page }) => {
    // No groups yet → the dashed "+ New group" entry point.
    await page.getByRole("button", { name: "+ New group" }).click();
    await page.getByLabel("Group name").fill("Strategy");
    await page.getByLabel("Group name").press("Enter");

    // Group now exists: type a value and add the tag.
    await page.getByLabel("Value…").fill("core");
    await page.getByRole("button", { name: "+ Tag" }).click();

    // The chip carries a hardcoded-English remove label: "Remove tag {group}: {v}".
    await expect(page.getByLabel("Remove tag Strategy: core")).toBeVisible();
  });
});
