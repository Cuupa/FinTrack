import { test, expect } from "@playwright/test";
import { dismissTour } from "./helpers";

// Every primary route has to mount its provider tree and render without a client
// error. The sidebar nav is flag-gated (all flags default-enabled without
// Supabase), so in Guest Mode all links are present. Clicking through exercises
// the nav wiring; the legal + settings routes are reached directly (no sidebar
// entry for guests).
test.describe("navigation", () => {
  test("sidebar reaches every primary route", async ({ page }) => {
    await page.goto("/");
    await dismissTour(page);

    const routes: { link: RegExp; heading: RegExp }[] = [
      { link: /^Analysis$/, heading: /^Analysis$/ },
      { link: /^Dividends$/, heading: /^Dividends$/ },
      { link: /^X-Ray$/, heading: /^Portfolio X-Ray$/ },
      { link: /^Rebalance$/, heading: /^Rebalancing$/ },
      { link: /^Simulation$/, heading: /^Simulation$/ },
    ];

    for (const { link, heading } of routes) {
      await page.getByRole("link", { name: link }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }

    // …and back to the dashboard.
    await page.getByRole("link", { name: /^Dashboard$/ }).first().click();
    await expect(page.getByText("Your portfolio at a glance.")).toBeVisible();
  });

  test("settings and legal pages render", async ({ page }) => {
    const direct: { path: string; heading: RegExp }[] = [
      { path: "/settings", heading: /^Settings$/ },
      { path: "/impressum", heading: /^Imprint$/ },
      { path: "/datenschutz", heading: /^Privacy Policy$/ },
      { path: "/terms", heading: /^Terms of Service$/ },
    ];
    for (const { path, heading } of direct) {
      await page.goto(path);
      // Settings and legal pages carry no guided tour, so no dismissal needed.
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
  });
});
