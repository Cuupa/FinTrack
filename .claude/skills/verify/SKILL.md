# Verify FinTrack changes in the running app

## Launch
- `npm run dev` (background) → http://localhost:3000. Ready in ~5s.
- **Local dev is Guest Mode only**: `.env.local` has no Supabase keys (only a
  Vercel OIDC token), so login inputs are disabled locally. Verify flows in
  Guest Mode (LocalStore); registered-mode behavior can only be probed against
  prod (https://fintrack-five-cyan.vercel.app/, demo@demo.com / demo) which
  runs the deployed code, not your working tree.
- Guest Mode still has real market data: `/api/lookup`, `/api/price`,
  `/api/history` work without Supabase (Yahoo server-side). Only catalog,
  crypto ids and live-quote cron data are missing.

## Drive (Playwright)
- No playwright dep in the repo. Use `playwright-core` installed in the
  scratchpad + the system-cached browser:
  `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` via
  `chromium.launch({ executablePath })`.
- Viewport 1920x1080 (owner rule). Persist `storageState` between scripts to
  keep the guest localStorage data.

## Gotchas
- A guided tour auto-opens on dashboard and simulation: dismiss with
  `getByText("Tour überspringen")` (EN: /Skip tour/i) before clicking anything.
- Locale chips (EN/DE/ES) render uppercase via CSS; the DOM text is lowercase:
  `locator("button[aria-pressed]").filter({ hasText: /^en$/i })`. Never use
  `button:has-text('EN')` — it substring-matches "Anmelden".
- Asset rows: the first `a[href*="/assets/"]` match is a hidden mobile-list
  link; grab its href and `page.goto` it instead of clicking.
- Seeding: dashboard "+ Position hinzufügen" → fill `getByPlaceholder(/A2PKXG/)`
  with an ISIN → button "Importieren" (exact: true) → wait ~6s for Yahoo →
  fill the empty unlabeled quantity input → "Position hinzufügen" (exact).
- Slider "Wert eingeben" toggles the slider into an `input[type=number]`
  (no aria-label) — fill that, press Enter.
- Monte Carlo run: click "Simulation starten", allow ~10s for the worker.
