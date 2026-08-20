import { expect, test } from "@playwright/test";
import {
  bookTransaction,
  dismissTour,
  openAddAccountModal,
  submitAddAccountModal,
} from "./helpers";

// The overview is not a depot report (owner call, spec §9): the hero leads with
// the financial STATUS (net worth, what is liquid, what is invested, what is
// owed), and the securities-only return metrics (savings rate, P&L, IRR) moved
// to /portfolio and the health section. The overview chart became the
// assets-vs-liabilities breakdown instead of a single net-worth line.
//
// What only the wiring can show: the same hero component renders a DIFFERENT
// set depending on `investmentsOnly`, the everyday figures are really derived
// from the ledger, and the window's change is its own KPI (not the whole debt).

async function seed(page: import("@playwright/test").Page) {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Current account");
  await page.locator("#account-opening").fill("4000");
  await submitAddAccountModal(page);
  await expect(
    page.locator('[data-tour="accounts-list"]').getByText("Current account"),
  ).toBeVisible();

  await page.goto("/spending");
  await dismissTour(page);

  // 3000 in, 1200 out in one month -> a savings rate of exactly 60%.
  await bookTransaction(page, { type: "Income", payee: "Salary", amount: "3000" });
  await bookTransaction(page, { type: "Expense", payee: "Rent", amount: "1200" });
}

test("the overview leads with everyday money, the portfolio page with the depot", async ({
  page,
}) => {
  await seed(page);

  await page.goto("/");
  await dismissTour(page);
  const hero = page.locator('[data-tour="net-worth"]');
  // Status figures, not depot performance.
  await expect(hero).toContainText("Net worth");
  await expect(hero).toContainText("Liquid available");
  // The depot-only pair belongs to /portfolio, not here.
  await expect(hero).not.toContainText("Unrealized P&L");
  // Savings rate left the hero for the health section.
  await expect(hero).not.toContainText("Savings rate");

  // Derived from the ledger, not a placeholder: a real savings-rate percent
  // (income booked, so it is positive), now shown in the health section (a
  // card of its own on the overview). The exact figure is a trailing-window
  // average, so pin the shape -- a "no data" placeholder would not match.
  const savingsRate = page
    .getByText("Savings rate", { exact: true })
    .locator("xpath=following-sibling::div");
  await expect(savingsRate).toHaveText(/\+\d+(\.\d+)?\s*%/);

  await page.goto("/portfolio");
  await dismissTour(page);
  const depotHero = page.locator('[data-tour="net-worth"]');
  await expect(depotHero).toContainText("Portfolio value");
  await expect(depotHero).toContainText("Unrealized P&L");
  // The everyday status figures are the overview's, not the depot's.
  await expect(depotHero).not.toContainText("Liquid available");
});

// (The overview's per-account "accounts card" was retired in the §9 overview
// unification: Konten now live in the KPI strip, the month pair and the
// plan-progress card, not in a Konten/Ausgaben/Ziele card trio. The account
// ranking that card used is still covered by the pure accountsTotals unit
// tests.)

// The overview leads with net worth over time (the assets-vs-liabilities
// breakdown), and the window's change is its own KPI. Only the wiring can show
// that the change stat is the window's change and not the whole debt, that the
// overview carries no Wealth/Return toggle, and that return mode -- which lives
// on the depot -- names itself the depot's there and nowhere else.
test("the overview's change is the window's change, not the whole debt", async ({
  page,
}) => {
  await page.goto("/accounts");
  await dismissTour(page);

  await openAddAccountModal(page);
  await page.getByRole("dialog").locator("#account-name").fill("Current account");
  await page.getByRole("dialog").locator("#account-opening").fill("4000");
  await submitAddAccountModal(page);

  await openAddAccountModal(page);
  const dialog = page.getByRole("dialog");
  await dialog.locator("#account-name").fill("House");
  await dialog.getByRole("button", { name: "Type" }).click();
  await page.getByRole("option", { name: "Mortgage", exact: true }).click();
  await dialog.locator("#account-opening").fill("200000");
  await submitAddAccountModal(page);

  await page.goto("/");
  await dismissTour(page);
  const hero = page.locator('[data-tour="net-worth"]');

  // Net worth is -196,000: the KPI states it and the breakdown chart names it.
  await expect(hero).toContainText("196,000");

  // The overview chart is the assets-vs-liabilities breakdown, not a return
  // line: its accessible summary says so.
  const chart = hero.locator('[role="img"]').first();
  await expect(chart).toBeVisible();
  expect(await chart.getAttribute("aria-label")).toMatch(/breakdown|assets/i);

  // The window CHANGE is its own KPI, ~0 with flat balances -- it must never be
  // the entire net worth. (This invariant moved from the old net-worth line's
  // summary into the Change stat when the overview chart became the breakdown.)
  const changeValue = hero
    .getByText(/^Change \(/)
    .locator("xpath=ancestor::div[1]/following-sibling::div[1]");
  await expect(changeValue).not.toContainText("196,000");

  // The Wealth/Return toggle belongs to the depot, not the net-worth page.
  await expect(hero.getByRole("button", { name: "Return", exact: true })).toHaveCount(0);

  // The depot page owns return mode; its line has no account in it, so
  // switching to Return raises no "portfolio only" scope note.
  await page.goto("/portfolio");
  await dismissTour(page);
  const depotHero = page.locator('[data-tour="net-worth"]');
  await depotHero.getByRole("button", { name: "Return", exact: true }).click();
  await expect(
    depotHero.getByText(/Return and risk figures cover the portfolio only/),
  ).toBeHidden();
});
