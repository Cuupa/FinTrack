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
      // X-Ray folded into Analysis as a tab (P5.1): no standalone nav link.
      // The /xray -> /analysis?tab=xray redirect is covered below.
      { link: /^Rebalance$/, heading: /^Rebalancing$/ },
      { link: /^Simulation$/, heading: /^Simulation$/ },
    ];

    for (const { link, heading } of routes) {
      await page.getByRole("link", { name: link }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // Every primary page carries its own guided tour (round 24), whose
      // full-screen overlay would swallow the next sidebar click.
      await dismissTour(page);
    }

    // …and back to the dashboard.
    await page.getByRole("link", { name: /^Dashboard$/ }).first().click();
    await expect(page.getByText("Everything you own, owe and spend, in one place.")).toBeVisible();
  });

  test("the old /xray link redirects onto the Analysis X-Ray tab", async ({ page }) => {
    await page.goto("/xray");
    await dismissTour(page);
    await expect(page).toHaveURL(/\/analysis\?tab=xray/);
    await expect(page.getByRole("heading", { level: 1, name: /^Analysis$/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^X-Ray$/, selected: true })).toBeVisible();
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
