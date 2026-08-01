import { expect, test } from "@playwright/test";
import { dismissTour, setLocale } from "./helpers";

// The FIRE/Rente merge (TODO "FIRE/Rente"): one nav entry, one page, two tabs.
//
// The arithmetic behind each half is pinned by tests/fire.test.ts and
// tests/pension.test.ts, and the pension surface itself by e2e/pension.spec.ts.
// What only a browser can see is the wiring the merge introduced: that the two
// old routes still land somewhere useful, that the tab actually swaps the
// panel, and that the nav offers one entry where it used to offer two.

test("the old routes redirect onto their tab", async ({ page }) => {
  await page.goto("/fire");
  await dismissTour(page);
  await expect(page).toHaveURL(/\/retirement\?tab=fire/);
  await expect(page.getByRole("tab", { name: "FIRE" })).toHaveAttribute("aria-selected", "true");

  await page.goto("/pension");
  await dismissTour(page);
  await expect(page).toHaveURL(/\/retirement\?tab=pension/);
  await expect(page.getByRole("tab", { name: "Pension" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("switching tab swaps the panel and the URL", async ({ page }) => {
  await page.goto("/retirement");
  await dismissTour(page);

  // Default tab is FIRE, so the pension points card must not be mounted.
  await expect(page.locator('[data-tour="pension-points"]')).toHaveCount(0);

  await page.getByRole("tab", { name: "Pension" }).click();
  await expect(page.locator('[data-tour="pension-points"]')).toBeVisible();
  await expect(page).toHaveURL(/tab=pension/);

  // Reload keeps the tab: the URL is the state, so a bookmark is honest.
  await page.reload();
  await dismissTour(page);
  await expect(page.locator('[data-tour="pension-points"]')).toBeVisible();
});

test("the navigation offers one retirement entry, not two", async ({ page }) => {
  await setLocale(page, "de");
  await page.goto("/retirement");
  await dismissTour(page);

  const nav = page.locator('[data-tour="nav"]');
  await expect(nav.getByRole("link", { name: "Ruhestand" })).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "FIRE" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Rente", exact: true })).toHaveCount(0);

  // The page title is the umbrella, the tabs name the two halves.
  await expect(page.getByRole("heading", { level: 1, name: "Ruhestand" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Rente" })).toBeVisible();
});
