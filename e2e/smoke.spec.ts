import { test, expect } from "@playwright/test";
import { dismissTour, setLocale } from "./helpers";

// Boot + i18n wiring: the whole provider chain (Auth → Catalog → Portfolio →
// LivePrices), the store seam picking LocalStore, and the i18n provider stamping
// <html lang> all have to work for any of this to render. A pure unit test can't
// see any of it.
test.describe("dashboard boot & i18n", () => {
  test("renders the dashboard in Guest Mode", async ({ page }) => {
    await page.goto("/");
    await dismissTour(page);
    // Guest default locale is English.
    await expect(page.getByText("Everything you own, owe and spend, in one place.")).toBeVisible();
    // The area cards are the dashboard's own content and are always present
    // with no data. (The add-asset entry point lives on /portfolio now.)
    await expect(page.locator('[data-tour="areas"]')).toBeVisible();
  });

  test("switching locale re-renders copy and updates <html lang>", async ({ page }) => {
    // setLocale switches in Settings and asserts <html lang>; here we verify the
    // choice propagates to another page's copy (the dashboard subtitle).
    await setLocale(page, "de");
    await page.goto("/");
    await dismissTour(page);
    await expect(page.getByText("Alles, was du besitzt, schuldest und ausgibst, an einem Ort.")).toBeVisible();

    await setLocale(page, "es");
    await page.goto("/");
    await dismissTour(page);
    await expect(page.getByText("Todo lo que tienes, debes y gastas, en un solo lugar.")).toBeVisible();

    await setLocale(page, "en");
    await page.goto("/");
    await dismissTour(page);
    await expect(page.getByText("Everything you own, owe and spend, in one place.")).toBeVisible();
  });
});
