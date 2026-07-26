import { chromium } from "playwright";

const SEED = {
  profile: { currency: "EUR", locale: "de" },
  accounts: [
    { id: "acc-haus", name: "Hauskauf", kind: "mortgage", currency: null, isLiability: true,
      openingBalance: 329000, openedOn: "2025-01-01", interestRate: 4.17, minPayment: 1398,
      rateFixedUntil: "2036-06-30", followUpRate: 6 },
    { id: "acc-neben", name: "Hausnebenkosten", kind: "loan", currency: null, isLiability: true,
      openingBalance: 62000, openedOn: "2025-01-01", interestRate: 8.09, minPayment: 523,
      rateFixedUntil: null, followUpRate: null },
  ],
  accountBalances: [],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("http://localhost:3011/", { waitUntil: "domcontentloaded" });
await page.evaluate((seed) => {
  const raw = localStorage.getItem("fintrack:portfolio:v1");
  const base = raw ? JSON.parse(raw) : {};
  localStorage.setItem("fintrack:portfolio:v1", JSON.stringify({
    ...base,
    profile: { ...(base.profile ?? {}), ...seed.profile },
    accounts: seed.accounts,
    accountBalances: seed.accountBalances,
  }));
  localStorage.setItem("fintrack:locale", "de");
}, SEED);
await page.goto("http://localhost:3011/debt", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const out = process.argv[2] ?? "debt.png";
await page.screenshot({ path: out, fullPage: true });
console.log("body text:\n", (await page.locator("main").innerText()).slice(0, 1500));
await browser.close();
