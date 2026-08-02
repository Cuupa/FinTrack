import { expect, test, type Page } from "@playwright/test";
import {
  dismissTour,
  openAddAccountModal,
  setLocale,
  submitAddAccountModal,
} from "./helpers";

/** YYYY-MM-DD `n` whole months back, so "due since then" is deterministic. */
function monthsAgo(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// Retirement provision (the Pension tab of /retirement, flag `pension`) in
// Guest Mode. The merge of /fire and /pension into one page is covered by
// e2e/retirement.spec.ts; this spec is about the projection surface itself.
//
// The projection arithmetic is pinned by tests/pension.test.ts; what only a
// browser can see is the wiring: that a typed year survives the store seam and
// comes back after a reload, that retyping the same year REPLACES it rather
// than stacking a duplicate (the replace-set semantics the DB's unique
// (user_id, year) index also enforces), that a policy's expected payout reaches
// the summary tiles, and that the German page really is German.
//
// Local dev has no Supabase, so `pension_reference` is empty and the euro
// figures deliberately stay "—". That is the honest no-reference-data path and
// is asserted here rather than worked around: points still have to add up.

async function openPension(page: Page): Promise<void> {
  await page.goto("/retirement?tab=pension");
  await dismissTour(page);
}

async function addYear(page: Page, year: string, points: string): Promise<void> {
  const card = page.locator('[data-tour="pension-points"]');
  // Exact: the card also carries the statement total's "As of year" field.
  await card.getByLabel("Year", { exact: true }).fill(year);
  await card.getByLabel("Points", { exact: true }).fill(points);
  await card.getByRole("button", { name: "Add year", exact: true }).click();
}

async function addStatement(page: Page, year: string, total: string): Promise<void> {
  const card = page.locator('[data-tour="pension-points"]');
  await card.getByLabel("Statement year", { exact: true }).fill(year);
  await card.getByLabel("Total points", { exact: true }).fill(total);
  await card.getByRole("button", { name: "Add statement", exact: true }).click();
}

function statementRow(page: Page, year: string) {
  return page.locator('[data-tour="pension-points"] tbody tr').filter({ hasText: year });
}

function pointsRow(page: Page, year: string) {
  return page.locator('[data-tour="pension-points"] tbody tr').filter({ hasText: year });
}

test("a recorded year survives a reload and lands in the projection", async ({ page }) => {
  await openPension(page);
  await addYear(page, "2024", "1.25");

  await expect(pointsRow(page, "2024")).toContainText("1.2500");
  // With no birth year nothing is extrapolated, so the total is what was typed.
  await expect(page.locator('[data-tour="pension-summary"]')).toContainText("1.25");

  await page.reload();
  await dismissTour(page);
  await expect(pointsRow(page, "2024")).toContainText("1.2500");
});

test("retyping a year replaces it instead of stacking a duplicate", async ({ page }) => {
  await openPension(page);
  await addYear(page, "2023", "0.90");
  await addYear(page, "2023", "1.10");

  await expect(pointsRow(page, "2023")).toHaveCount(1);
  await expect(pointsRow(page, "2023")).toContainText("1.1000");
  await expect(page.locator('[data-tour="pension-summary"]')).toContainText("1.10");
});

test("deleting a year asks first and then removes it", async ({ page }) => {
  await openPension(page);
  await addYear(page, "2022", "1.00");

  await pointsRow(page, "2022").getByRole("button", { name: "Delete", exact: true }).click();
  // Owner rule: every destructive action confirms first. ConfirmDialog is an
  // alertdialog (it interrupts), unlike the plain Modal used by the forms.
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("2022");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(pointsRow(page, "2022")).toHaveCount(0);
});

test("a Renteninformation is a row of its own and survives a reload", async ({ page }) => {
  // A Renteninformation leads with a CUMULATIVE figure. Typed into a year's
  // row it used to be read as an annual rate (17 points -> ~20.000 EUR/month),
  // so each letter is its own entry now.
  await openPension(page);
  await addStatement(page, "2025", "17.0322");

  const summary = page.locator('[data-tour="pension-summary"]');
  await expect(summary).toContainText("17.03");

  await page.reload();
  await dismissTour(page);
  await expect(statementRow(page, "2025")).toContainText("17.0322");
  await expect(summary).toContainText("17.03");
});

test("years after the statement total add to it instead of replacing it", async ({ page }) => {
  await openPension(page);
  await addStatement(page, "2024", "10");

  // Covered by the statement: must NOT be counted twice.
  await addYear(page, "2023", "1.00");
  await expect(page.locator('[data-tour="pension-summary"]')).toContainText("10.00");

  // After the statement: genuinely new, so it adds.
  await addYear(page, "2025", "1.50");
  await expect(page.locator('[data-tour="pension-summary"]')).toContainText("11.50");
});

test("a birth year extrapolates the remaining years", async ({ page }) => {
  await openPension(page);
  await addYear(page, "2024", "1.00");

  const assumptions = page.locator('[data-tour="pension-assumptions"]');
  await assumptions.getByLabel("Year of birth").fill("1990");
  await assumptions.getByRole("button", { name: "Save", exact: true }).click();

  // Cohort 1990 draws at 67, and the standard age has to be surfaced.
  await expect(assumptions).toContainText("67");
  // The projection now covers every year to retirement, so the total is far
  // above the single recorded point.
  const summary = page.locator('[data-tour="pension-summary"]');
  await expect(summary).not.toContainText("1.00");
});

test("a policy's expected payout reaches the summary", async ({ page }) => {
  await openPension(page);

  await page
    .locator('[data-tour="pension-contracts"]')
    .getByRole("button", { name: "Add policy", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Riester Allianz");
  await dialog.getByLabel("Expected / month").fill("250");
  await dialog.getByRole("button", { name: "Add policy", exact: true }).click();

  await expect(
    page.locator('[data-tour="pension-contracts"] tbody tr').filter({ hasText: "Riester Allianz" }),
  ).toHaveCount(1);
  // Private policies are summed independently of the statutory half, which has
  // no Rentenwert to value it with locally.
  await expect(page.locator('[data-tour="pension-summary"]')).toContainText("250");
});

test("without reference data the euro figures stay blank rather than invented", async ({
  page,
}) => {
  await openPension(page);
  await addYear(page, "2024", "1.00");

  // No Supabase locally => `pension_reference` is empty => no Rentenwert. The
  // points stand; the statutory euro figure must not be conjured from a
  // hardcoded constant.
  const summary = page.locator('[data-tour="pension-summary"]');
  await expect(summary).toContainText("1.00");
  await expect(summary).toContainText("—");
});

test("the page is German in the German locale", async ({ page }) => {
  await setLocale(page, "de");
  await openPension(page);

  await expect(page.getByRole("heading", { level: 1, name: "Ruhestand" })).toBeVisible();
  await expect(page.locator('[data-tour="pension-points"]')).toContainText("Entgeltpunkte");
  await expect(page.locator('[data-tour="pension-contracts"]')).toContainText(
    "Rentenversicherungen",
  );
  // Informal register (owner rule, absolute): never "Sie"/"Ihre".
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\b(Ihre|Ihrer|Ihren|Sie)\b/);
});

test("two recorded values measure the policy's return", async ({ page }) => {
  // The form used to ask for a return percentage no statement prints. What the
  // user has is the Standmitteilung: a value on a date. The XIRR itself is
  // pinned by tests/pension.test.ts; what only a browser shows is that the
  // readings survive the store seam and reach the table's return column.
  await openPension(page);
  const contracts = page.locator('[data-tour="pension-contracts"]');
  await contracts.getByRole("button", { name: "Add policy", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill("Allianz");
  await form.getByRole("button", { name: "Add policy", exact: true }).click();

  const row = contracts.locator("tbody tr").filter({ hasText: "Allianz" });
  await row.getByRole("button", { name: "Values", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Date", { exact: true }).fill("2024-01-01");
  await dialog.getByLabel("Value", { exact: true }).fill("10000");
  await dialog.getByRole("button", { name: "Add value", exact: true }).click();
  // One reading cannot measure anything, and the page says so instead of
  // annualising a single point.
  await expect(dialog).toContainText(/second reading/i);

  await dialog.getByLabel("Date", { exact: true }).fill("2025-01-01");
  await dialog.getByLabel("Value", { exact: true }).fill("11000");
  await dialog.getByRole("button", { name: "Add value", exact: true }).click();
  // 9.97, not 10: 2024 is a leap year and the XIRR annualises over 365 days.
  await expect(dialog).toContainText(/Measured return 9\.9\d % p\. a\./);

  // The modal's own ✕ carries the same accessible name; take the footer one.
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
  // The newest reading is the capital, and the measured rate reaches the table.
  await expect(row).toContainText("11,000.00");
  await expect(row).toContainText("9.97 %");

  await page.reload();
  await dismissTour(page);
  await expect(
    contracts.locator("tbody tr").filter({ hasText: "Allianz" }),
  ).toContainText("9.97 %");
});

test("a policy with a settlement account collects its premiums for review", async ({ page }) => {
  // Nothing is ever posted silently: due premiums collect, each one is
  // deselectable, and booking them debits the account.
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  const account = page.getByRole("dialog");
  await account.getByLabel("Name").fill("Girokonto");
  await submitAddAccountModal(page);

  await openPension(page);
  const contracts = page.locator('[data-tour="pension-contracts"]');
  await contracts.getByRole("button", { name: "Add policy", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill("Allianz");
  await form.getByLabel("Contribution / month").fill("150");
  await form.getByLabel("Settlement account").click();
  await page.getByRole("option", { name: "Girokonto" }).click();
  await form.getByLabel("First premium on").fill(monthsAgo(2));
  await form.getByRole("button", { name: "Add policy", exact: true }).click();

  // Two months back means three due premiums (start month included).
  await expect(contracts).toContainText("Due premiums (3)");
  await contracts.getByRole("button", { name: /Book 3 premiums/ }).click();
  await expect(contracts).not.toContainText("Due premiums");

  // A premium is a transfer, not consumption: it moves the balance without
  // being reported as spending.
  await page.goto("/accounts");
  await dismissTour(page);
  await expect(page.getByRole("row").filter({ hasText: "Allianz" }).first()).toContainText(
    "150",
  );
});
