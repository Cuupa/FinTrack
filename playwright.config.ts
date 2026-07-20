import { defineConfig, devices } from "@playwright/test";

// End-to-end (browser) tests. These complement the vitest unit suite: unit
// tests pin the pure finance/i18n core, E2E pins the *wiring* — providers, the
// store seam, forms and charts actually rendering in a real browser (the class
// of integration bug unit tests over pure functions structurally can't catch).
//
// Local dev is Guest Mode only (`.env.local` carries no Supabase keys), so every
// spec here drives the LocalStore path. Registered-mode flows can only be
// verified against the deployed app, out of scope for this suite.
//
// Browser: reuses the system-cached Chromium (revision 1228, matching
// @playwright/test 1.61.x) — no per-run download. On a fresh machine run
// `npx playwright install chromium` once.
export default defineConfig({
  testDir: "./e2e",
  // One dev server, shared; keep the run serial so the single Next dev process
  // isn't contended and traces stay easy to read.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    // Owner rule: emulate desktop at 1080p.
    viewport: { width: 1920, height: 1080 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],
  // Boot the app the same way `npm run dev` does, so a bare `npm run test:e2e`
  // is fully reproducible. Reuse an already-running dev server locally.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
