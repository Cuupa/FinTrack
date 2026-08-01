import { test, expect } from "@playwright/test";
import {
  addOtherAsset,
  dismissTour,
  openAddAccountModal,
  openDashboard,
  submitAddAccountModal,
} from "./helpers";

/** Clicks Export → the named format and returns the downloaded file's text. */
async function downloadExport(page: import("@playwright/test").Page, item: string) {
  await page.getByRole("button", { name: /^Export$/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: item }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { download, content: Buffer.concat(chunks).toString("utf8") };
}

// The CSV export builds the file in-memory and triggers a real browser download
// (no server round trip). Capturing the download and checking its marker line
// proves the whole client export path end to end.
test.describe("export (Guest Mode)", () => {
  test("CSV export downloads a FinTrack export file", async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, "Vienna Apartment", "300000");

    const { download, content } = await downloadExport(page, "Download CSV");
    expect(download.suggestedFilename()).toMatch(/^fintrack-.*\.csv$/);
    expect(content).toContain("# FinTrack export");
    expect(content).toContain("Vienna Apartment");
  });

  // The export used to stop at the depot. Everything the app stores now has a
  // section, and the button is no longer gated on owning securities -- someone
  // who only tracks their everyday money had a permanently dead Export button.
  test("the file carries the everyday-money data, not just the depot", async ({ page }) => {
    await page.goto("/accounts");
    await dismissTour(page);
    await openAddAccountModal(page);
    await page.locator("#account-name").fill("Girokonto");
    await page.locator("#account-opening").fill("2500");
    await submitAddAccountModal(page);
    await expect(page.locator('[data-tour="accounts-list"]').getByText("Girokonto")).toBeVisible();

    // The Export menu lives on /portfolio (app/portfolio/page.tsx); the profile
    // menu carries the same two items app-wide.
    await page.goto("/portfolio");
    await dismissTour(page);
    const { content } = await downloadExport(page, "Download CSV");

    expect(content).toContain("# Accounts");
    expect(content).toContain("Girokonto");
    // No securities at all, yet the export ran: the section that anchors the
    // re-import format is still written, empty.
    expect(content).toContain("# Transactions");
  });

  test("the JSON snapshot never carries the user's own API key", async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, "Vienna Apartment", "300000");
    // Guest mode stores the LLM config in the same local blob as everything
    // else, so writing it directly is the honest way to arm this.
    await page.evaluate(() => {
      const key = "fintrack:portfolio:v1";
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error("guest blob missing");
      const parsed = JSON.parse(raw);
      parsed.llmConfig = { provider: "anthropic", model: "claude-opus-5", key: "sk-ant-SECRET" };
      localStorage.setItem(key, JSON.stringify(parsed));
    });
    await page.reload();
    await dismissTour(page);

    const { content } = await downloadExport(page, "Download JSON");
    expect(content).not.toContain("sk-ant-SECRET");
    expect(JSON.parse(content).data.llmConfig).toBeNull();
  });
});
