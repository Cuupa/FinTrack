import { test, expect } from "@playwright/test";
import { openDashboard, addOtherAsset } from "./helpers";

// The integration path unit tests miss end-to-end: the add-asset form mutates
// through the store seam (LocalStore.addAsset), the manual-valuation registry
// repopulates, the holdings table derives the position, the net-worth series is
// recomputed, and — crucially — it all survives a reload from localStorage.
test.describe("seed a manual-valuation holding (Guest Mode)", () => {
  test("added OTHER asset shows up, values, and persists across reload", async ({ page }) => {
    await openDashboard(page);

    const name = "Vienna Apartment";
    await addOtherAsset(page, name, "300000");

    // It lands in the holdings table. `.filter({ visible: true })` skips the
    // duplicate hidden mobile-list node that carries the same text.
    await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
    // …and its 300,000 value flows through into the net-worth headline
    // (compact "300k" or grouped "300,000", locale-dependent).
    await expect(
      page.getByText(/300[.,]?0{0,3}\s*k|300[.,]000/i).filter({ visible: true }).first(),
    ).toBeVisible();

    // Guest data lives in localStorage; a reload must rehydrate it.
    await page.reload();
    await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
  });
});
