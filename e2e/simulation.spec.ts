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

  // There is exactly ONE Monte Carlo surface: the FIRE tab hands its horizon
  // to the simulator instead of running a simulation of its own.
  test("the FIRE tab hands its horizon to the one simulation", async ({ page }) => {
    await openDashboard(page);
    await page.goto("/retirement?tab=fire");
    await dismissTour(page);

    // The old second simulation is gone: no run button on this page.
    await expect(page.getByRole("button", { name: /Run simulation/i })).toHaveCount(0);

    await page.getByRole("link", { name: "Open the simulation" }).click();
    await expect(page).toHaveURL(/\/simulation\?years=\d+&withdrawal=30/);
    await dismissTour(page);

    // The horizon arrives as the investment horizon, and the drawdown phase is
    // switched on with it.
    await expect(page.getByText(/Horizon taken from your FIRE plan/)).toBeVisible();
    await expect(page.getByText("Annual withdrawal rate")).toBeVisible();
    await expect(page.getByText("Withdrawal strategy")).toBeVisible();
  });

  // A forced bad sequence is a market assumption, so it applies to a run that
  // never draws anything down too.
  test("the stress scenario is offered without a withdrawal phase", async ({ page }) => {
    await openDashboard(page);
    await page.goto("/simulation");
    await dismissTour(page);
    await expect(page.getByText("Stress scenario")).toBeVisible();
  });
});
