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
    // Seeding the first holding auto-opens the portfolio tour, whose overlay
    // would swallow the sidebar click.
    await dismissTour(page);

    await page.getByRole("link", { name: /^Simulation$/ }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Simulation" })).toBeVisible();
    await dismissTour(page); // the simulation page auto-starts its own tour

    await page.getByRole("button", { name: "Run simulation" }).click();

    // The worker takes a few seconds; the projected-final-wealth tile appears on success.
    await expect(page.getByText("Projected final wealth")).toBeVisible({ timeout: 30_000 });
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

  // The drawdown is not a bare rate on the depot: guaranteed income pays part
  // of it. Only a browser proves the projection reaches the run, since the
  // figures come from the Pension tab's own store data, not from the link.
  test("the drawdown counts the pension from the user's own projection", async ({ page }) => {
    await openDashboard(page);

    // A policy plus a birth year is the smallest input that yields a bridge:
    // locally there is no Rentenwert, so only the private half can be valued.
    await page.goto("/retirement?tab=pension");
    await dismissTour(page);
    await page
      .locator('[data-tour="pension-contracts"]')
      .getByRole("button", { name: "Add policy", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Riester");
    await dialog.getByLabel("Expected / month").fill("250");
    await dialog.getByRole("button", { name: "Add policy", exact: true }).click();
    const assumptions = page.locator('[data-tour="pension-assumptions"]');
    await assumptions.getByLabel("Year of birth").fill("1990");
    await assumptions.getByRole("button", { name: "Save", exact: true }).click();

    // A FIRE plan that does NOT count the pension hands that choice over.
    await page.goto("/simulation?years=20&withdrawal=30");
    await dismissTour(page);
    const toggle = page.getByRole("switch").filter({ hasText: "Count my pension" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/a year of pension from/)).toBeVisible({ timeout: 30_000 });
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
