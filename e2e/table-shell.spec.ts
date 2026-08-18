import { expect, test } from "@playwright/test";
import { addOtherAsset, dismissTour, openAddAccountModal, openAssetDetail, openEntryMask, setLocale, submitAddAccountModal } from "./helpers";

// Pins what the shared table shell (components/ui/table.tsx) guarantees on the
// surfaces migrated in round 27: every column header is a real <button> that
// flips `aria-sort`, and no header nests a button inside a button (invalid HTML
// React rejects at hydration). The hand-rolled `<th onClick>` headers these
// replaced announced no sort state and were unreachable by keyboard.

test("no table header nests a button inside a button", async ({ page }) => {
  for (const path of ["/portfolio", "/spending", "/accounts", "/debt", "/analysis"]) {
    await page.goto(path);
    await dismissTour(page);
    expect(await page.locator("th button button").count(), path).toBe(0);
  }
});

test("the recurring card's headers sort and announce it", async ({ page }) => {
  await page.goto("/accounts");
  await dismissTour(page);
  await openAddAccountModal(page);
  await page.locator("#account-name").fill("Current account");
  await page.locator("#account-opening").fill("2000");
  await submitAddAccountModal(page);

  await page.goto("/spending");
  await dismissTour(page);
  const form = await openEntryMask(page);
  await form.locator("#spending-recurring").click();
  await form.locator("#spending-amount").fill("17.99");
  await form.locator("#spending-payee").fill("Netflix");
  await form.getByRole("button", { name: "Add recurring entry", exact: true }).click();

  const card = page.locator('[data-tour="recurring-card"]');
  await expect(card.locator("th[aria-sort]")).toHaveCount(5);

  // By accessible name, not by text: the sort arrow is an aria-hidden glyph
  // inside the header, so the <th>'s textContent is never the label alone.
  const name = card.getByRole("columnheader", { name: "Name" });
  await expect(name).toHaveAttribute("aria-sort", "none");
  await name.getByRole("button").click();
  await expect(name).toHaveAttribute("aria-sort", "ascending");
  await name.getByRole("button").click();
  await expect(name).toHaveAttribute("aria-sort", "descending");
});

test("the transaction log sorts from the keyboard", async ({ page }) => {
  await addOtherAsset(page, "Verify Loft", "250000");
  await openAssetDetail(page, "Verify Loft");

  const date = page.getByRole("columnheader", { name: "Date" }).first();
  // Descending by default: the newest booking reads first.
  await expect(date).toHaveAttribute("aria-sort", "descending");
  // Enter on a focused header is the whole point of the shell's real <button>;
  // the `<th onClick>` it replaced could not be reached this way at all.
  await date.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(date).toHaveAttribute("aria-sort", "ascending");
});

test("the manual-valuation table is sortable in German too", async ({ page }) => {
  // Seeded in English (the helper drives English labels), then switched: the
  // shell has to keep working in de-DE, where the header words are longer.
  await addOtherAsset(page, "Pruef Loft", "300000");
  await setLocale(page, "de");
  await page.goto("/portfolio");
  await dismissTour(page);
  await openAssetDetail(page, "Pruef Loft");

  const value = page.getByRole("columnheader", { name: /^Wert/ }).first();
  await expect(value).toHaveAttribute("aria-sort", "none");
  await value.getByRole("button").click();
  await expect(value).toHaveAttribute("aria-sort", "ascending");
  await setLocale(page, "en");
});
