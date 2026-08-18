import { expect, type Locator, type Page } from "@playwright/test";

// Shared drivers for the Guest-Mode E2E specs. Kept text/locale-tolerant where
// possible (stable ids and data-tour hooks over copy) so a dictionary tweak
// doesn't break a flow test.

/**
 * A guided tour auto-opens (full-screen overlay) on first dashboard visit, a
 * beat after load. Wait briefly for its skip button; if it shows, dismiss it and
 * wait for the overlay to detach so it can't intercept later clicks. Pages
 * without a tour just fall through after the short timeout.
 */
export async function dismissTour(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: /Skip tour|Tour überspringen|Saltar tour/i });
  try {
    await skip.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    return;
  }
  await skip.click();
  await skip.waitFor({ state: "hidden" });
}

/**
 * Force a known locale via the EN/DE/ES switcher, which lives in the Settings
 * "Language" section (the only place it's mounted). The choice persists to the
 * guest profile, so subsequent pages render in it. DOM chip text is lowercase.
 */
export async function setLocale(page: Page, code: "en" | "de" | "es"): Promise<void> {
  await page.goto("/settings");
  await dismissTour(page);
  const chip = page
    .locator("button[aria-pressed]")
    .filter({ hasText: new RegExp(`^${code}$`, "i") });
  if ((await chip.getAttribute("aria-pressed")) !== "true") {
    await chip.click();
  }
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("lang", code);
}

/** Open the dashboard in Guest Mode with no tour overlay (default locale: en). */
export async function openDashboard(page: Page): Promise<void> {
  await page.goto("/");
  await dismissTour(page);
}

/**
 * Add an OTHER (manual-valuation) holding — a fully network-free seed: name-only
 * master data, an opening value, no Yahoo lookup and no catalog.
 *
 * Navigates to /portfolio itself: holdings and the add-asset entry point moved
 * off the dashboard, and every spec that assumed otherwise sat red.
 */
export async function addOtherAsset(
  page: Page,
  name: string,
  value: string,
): Promise<void> {
  await page.goto("/portfolio");
  await dismissTour(page);
  await page.locator('[data-tour="add-asset"]').click();
  // Scope to the modal: once an OTHER asset exists, the holdings table grows an
  // "Other" type-filter button that would otherwise collide with the form's.
  const dialog = page.getByRole("dialog");
  // Switch the form to manual entry, then pick the OTHER type.
  await dialog.getByRole("button", { name: /Or enter an asset manually/i }).click();
  await dialog.getByRole("button", { name: /^Other$/ }).click();
  await page.locator("#name").fill(name);
  // Quantity prefills to "1" for OTHER; only the opening value is required.
  await page.locator("#price").fill(value);
  await page.getByRole("button", { name: /^Add asset$/ }).click();
  // Wait for the form to close and the holding to land in the table.
  await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
}

/**
 * Open the detail page of a held asset by grabbing the visible holdings-row link
 * (the first `a[href*="/assets/"]` is a hidden mobile-list node — filter to the
 * visible one). Asserts the detail heading, dismissing the asset-tags tour.
 */
export async function openAssetDetail(page: Page, name: string): Promise<void> {
  const link = page.locator('a[href*="/assets/"]').filter({ visible: true }).first();
  const href = await link.getAttribute("href");
  await page.goto(href!);
  await dismissTour(page);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/**
 * Opens the add-account modal from the /accounts header button. The form moved
 * behind it in round 28, mirroring how /portfolio hides "add asset", so every
 * spec that seeds an account goes through here instead of typing into a form
 * that is no longer on the page.
 */
export async function openAddAccountModal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add account", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Submits that modal and waits for it to close. */
export async function submitAddAccountModal(page: Page): Promise<void> {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add account", exact: true })
    .click();
}

/**
 * The entry mask moved behind the "Add a transaction" header button into a
 * modal (account-booking cleanup): the fields no longer sit permanently on the
 * page. Opens it and returns the dialog carrying them. Callers fill and submit
 * from the returned locator; a successful add closes the modal.
 */
export async function openEntryMask(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Add a transaction", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#spending-amount")).toBeVisible();
  return dialog;
}

/** Books one transaction through the entry mask and waits for the modal to close. */
export async function bookTransaction(
  page: Page,
  opts: {
    type?: "Expense" | "Income";
    account?: string;
    payee: string;
    amount: string;
    transferTo?: string;
  },
): Promise<void> {
  const form = await openEntryMask(page);
  if (opts.type === "Income") {
    await form.getByRole("button", { name: "Income", exact: true }).click();
  }
  if (opts.account) {
    await form.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("option", { name: opts.account }).click();
  }
  await form.locator("#spending-amount").fill(opts.amount);
  await form.locator("#spending-payee").fill(opts.payee);
  if (opts.transferTo) {
    await form.getByRole("button", { name: "Transfer to" }).click();
    await page.getByRole("option", { name: opts.transferTo }).click();
  }
  await form.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
