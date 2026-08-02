import { test, expect } from "@playwright/test";
import { openDashboard, addOtherAsset, dismissTour } from "./helpers";

// Monte Carlo runs off the main thread in a Web Worker
// (monte-carlo.worker.ts). Only a real browser can prove the worker boots,
// receives the derived per-asset stats, and posts results back to render — the
// single most "integration" flow in the app.
test.describe("simulation (Guest Mode)", () => {
  test("runs a Monte Carlo simulation and renders an outcome", async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, "Vienna Apartment", "300000");

    await page.getByRole("link", { name: /^Simulation$/ }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Simulation" })).toBeVisible();
    await dismissTour(page); // the simulation page auto-starts its own tour

    await page.getByRole("button", { name: "Run simulation" }).click();

    // The worker takes a few seconds; the median-outcome tile appears on success.
    await expect(page.getByText("Median outcome")).toBeVisible({ timeout: 30_000 });
  });

  // There is exactly ONE Monte Carlo surface: the FIRE tab links into the
  // simulator's Retirement mode instead of running its own.
  test("the FIRE tab links into the retirement mode instead of simulating", async ({ page }) => {
    await openDashboard(page);
    await page.goto("/retirement?tab=fire");
    await dismissTour(page);

    // The old second simulation is gone: no run button on this page.
    await expect(page.getByRole("button", { name: /Run simulation/i })).toHaveCount(0);

    await page.getByRole("link", { name: "Open the simulation" }).click();
    await expect(page).toHaveURL(/\/simulation\?mode=retirement/);
    await dismissTour(page);

    // The deep link selects the tab, and the withdrawal phase is already part
    // of the seeded plan.
    await expect(page.getByRole("tab", { name: "Retirement" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Years until retirement")).toBeVisible();
    await expect(page.getByText("Measured assumptions")).toBeVisible();
  });
});
