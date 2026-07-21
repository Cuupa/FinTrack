import { test, expect } from "@playwright/test";
import { openDashboard, addOtherAsset } from "./helpers";

// The CSV export builds the file in-memory and triggers a real browser download
// (no server round trip). Capturing the download and checking its marker line
// proves the whole client export path end to end.
test.describe("export (Guest Mode)", () => {
  test("CSV export downloads a FinTrack export file", async ({ page }) => {
    await openDashboard(page);
    await addOtherAsset(page, "Vienna Apartment", "300000");

    await page.getByRole("button", { name: /^Export$/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^fintrack-.*\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const content = Buffer.concat(chunks).toString("utf8");
    expect(content).toContain("# FinTrack export");
    expect(content).toContain("Vienna Apartment");
  });
});
