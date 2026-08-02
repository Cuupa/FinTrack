// Client-side export. Serialises the user's data to a JSON snapshot or to CSV
// and triggers a browser download. No server round-trip — the data already
// lives in memory.
//
// The CSV covers everything the app stores, one `# Section` per entity, and
// not just the depot: an export that dropped the accounts, the ledger, the
// goals and the pension was an export of a quarter of the product. Sections
// carry ids alongside the readable name so cross-references (a booking's
// account, a sub-goal's parent) survive the round trip; a section with no rows
// is left out entirely rather than written as a lone header.
//
// The Assets and Transactions sections are also the app's own re-import format
// (`fintrack` in lib/import/csv.ts) and therefore keep their exact column
// names and their position at the top of the file.

import type { PortfolioData } from "../types";
import type { TaxYearBreakdown } from "../finance/tax";
import type { TaxPackYear } from "../finance/tax-pack";

/** One CSV field. `undefined` covers the optional entity fields (a fee model a
 *  broker never set) and writes empty, exactly like null. */
type Cell = string | number | boolean | null | undefined;

/** Quote a CSV field per RFC 4180 when it contains a comma, quote, or newline. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvRows(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/**
 * One `# Name` section: the heading, the header row, then the data. Returns
 * null when there is nothing to write, so a user who never opened the pension
 * page does not get an empty "# Pension points" heading suggesting otherwise.
 *
 * `always` is for the two sections that DEFINE the re-import format: a file
 * without a "# Transactions" heading is not a FinTrack export as far as
 * `parseFinTrack` is concerned, and a depot with assets but no trades yet
 * would otherwise export as something the app cannot read back.
 */
function section(name: string, header: string[], rows: Cell[][], always = false): string | null {
  if (rows.length === 0 && !always) return null;
  return toCsvRows([[`# ${name}`], header, ...rows]);
}

/** Build a CSV covering every entity the app stores, one section each. */
export function portfolioToCsv(data: PortfolioData): string {
  const assetById = new Map(data.assets.map((a) => [a.id, a]));
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoryById = new Map(data.spendingCategories.map((c) => [c.id, c]));
  const goalById = new Map(data.goals.map((g) => [g.id, g]));
  const portfolioById = new Map(data.portfolios.map((p) => [p.id, p]));
  const assetName = (id: string) => assetById.get(id)?.name ?? id;
  const accountName = (id: string | null) => (id ? (accountById.get(id)?.name ?? id) : "");
  const categoryName = (id: string | null) => {
    if (!id) return "";
    const c = categoryById.get(id);
    return c ? `${c.groupName} · ${c.name}` : id;
  };

  // Assets and Transactions lead the file and keep their exact columns: they
  // are what `lib/import/csv.ts` reads back in.
  const sections = [
    section(
      "Assets",
      ["id", "name", "type", "isin", "wkn", "symbol", "currency", "notes"],
      data.assets.map((a) => [a.id, a.name, a.type, a.isin, a.wkn, a.symbol, a.currency, a.notes]),
      true,
    ),
    section(
      "Transactions",
      ["id", "date", "asset", "isin", "type", "quantity", "price", "fee", "tax"],
      data.transactions
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((t) => {
          const a = assetById.get(t.assetId);
          return [
            t.id,
            t.date,
            a?.name ?? t.assetId,
            a?.isin ?? "",
            t.type,
            t.quantity,
            t.price,
            t.fee,
            t.tax,
          ];
        }),
      true,
    ),
    // A portfolio IS a broker: its fee model and Freistellungsauftrag are part
    // of the record, not app settings.
    section(
      "Brokers",
      ["id", "name", "taxAllowance", "feeOrderFlat", "feeOrderFreeFrom", "feeSavingsPlan"],
      data.portfolios.map((p) => [
        p.id,
        p.name,
        p.taxAllowance,
        p.feeOrderFlat,
        p.feeOrderFreeFrom,
        p.feeSavingsPlan,
      ]),
    ),
    section(
      "Savings plans",
      ["id", "asset", "broker", "amount", "interval", "startDate", "active", "lastRunDate"],
      data.savingsPlans.map((p) => [
        p.id,
        assetName(p.assetId),
        portfolioById.get(p.portfolioId)?.name ?? p.portfolioId,
        p.amount,
        p.interval,
        p.startDate,
        p.active,
        p.lastRunDate,
      ]),
    ),
    section(
      "Watchlist",
      ["name", "type", "isin", "wkn", "symbol", "currency"],
      data.watchlist.map((w) => [w.name, w.type, w.isin, w.wkn, w.symbol, w.currency]),
    ),
    // Tags are grouped key-value pairs, so one row per assigned value rather
    // than a column per group -- groups are user-defined and unbounded.
    section(
      "Tags",
      ["asset", "group", "value"],
      data.tagGroups.flatMap((g) =>
        Object.entries(data.tagAssignments).flatMap(([assetId, byGroup]) =>
          (byGroup[g.id] ?? []).map((value) => [assetName(assetId), g.name, value] as Cell[]),
        ),
      ),
    ),
    // Manual valuations for OTHER assets: a figure the user set, which no
    // market price can reconstruct.
    section(
      "Manual valuations",
      ["asset", "date", "value"],
      data.valuationPoints.map((v) => [assetName(v.assetId), v.date, v.value]),
    ),
    section(
      "Accounts",
      [
        "id",
        "name",
        "kind",
        "currency",
        "isLiability",
        "openingBalance",
        "openedOn",
        "interestRate",
        "interestFrequency",
        "minPayment",
        "rateFixedUntil",
        "followUpRate",
      ],
      data.accounts.map((a) => [
        a.id,
        a.name,
        a.kind,
        a.currency,
        a.isLiability,
        a.openingBalance,
        a.openedOn,
        a.interestRate,
        a.interestFrequency,
        a.minPayment,
        a.rateFixedUntil,
        a.followUpRate,
      ]),
    ),
    section(
      "Account balances",
      ["account", "date", "balance"],
      data.accountBalances
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((b) => [accountName(b.accountId), b.date, b.balance]),
    ),
    section(
      "Spending categories",
      ["id", "group", "name", "taxDeductible"],
      data.spendingCategories.map((c) => [c.id, c.groupName, c.name, c.taxDeductible ?? false]),
    ),
    section(
      "Bookings",
      ["id", "date", "account", "category", "payee", "amount", "transferAccount", "note"],
      data.spendingTransactions
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((t) => [
          t.id,
          t.date,
          accountName(t.accountId),
          categoryName(t.categoryId),
          t.payee,
          t.amount,
          accountName(t.transferAccountId ?? null),
          t.note,
        ]),
    ),
    section(
      "Budgets",
      ["category", "amount"],
      data.budgets.map((b) => [categoryName(b.categoryId), b.amount]),
    ),
    section(
      "Recurring payments",
      [
        "name",
        "amount",
        "interval",
        "category",
        "account",
        "renewalDate",
        "cancellationNoticeDays",
        "insuranceType",
        "sumInsured",
      ],
      data.contracts.map((c) => [
        c.name,
        c.amount,
        c.interval,
        categoryName(c.categoryId),
        accountName(c.accountId ?? null),
        c.renewalDate,
        c.cancellationNoticeDays,
        c.insuranceType,
        c.sumInsured,
      ]),
    ),
    section(
      "Planned income & expenses",
      ["name", "amount", "interval", "startDate", "endDate", "account", "category", "monthEnd"],
      data.plannedCashflows.map((p) => [
        p.name,
        p.amount,
        p.interval,
        p.startDate,
        p.endDate,
        accountName(p.accountId),
        categoryName(p.categoryId),
        p.monthEnd ?? false,
      ]),
    ),
    section(
      "Goals",
      [
        "name",
        "targetAmount",
        "targetDate",
        "parentGoal",
        "linkedAccount",
        "tracksInvestments",
        "manualCurrentAmount",
      ],
      data.goals.map((g) => [
        g.name,
        g.targetAmount,
        g.targetDate,
        g.parentGoalId ? (goalById.get(g.parentGoalId)?.name ?? g.parentGoalId) : "",
        accountName(g.linkedAccountId),
        g.tracksInvestments,
        g.manualCurrentAmount,
      ]),
    ),
    section(
      "Pension points",
      ["year", "points", "note"],
      data.pensionPoints
        .slice()
        .sort((a, b) => a.year - b.year)
        .map((p) => [p.year, p.points, p.note]),
    ),
    section(
      "Pension statements",
      ["year", "totalPoints", "note"],
      data.pensionStatements
        .slice()
        .sort((a, b) => a.year - b.year)
        .map((p) => [p.year, p.totalPoints, p.note]),
    ),
    section(
      "Pension policies",
      [
        "name",
        "kind",
        "provider",
        "monthlyContribution",
        "currentValue",
        "expectedMonthlyPension",
        "startsOn",
        "note",
      ],
      data.pensionContracts.map((c) => [
        c.name,
        c.kind,
        c.provider,
        c.monthlyContribution,
        c.currentValue,
        c.expectedMonthlyPension,
        c.startsOn,
        c.note,
      ]),
    ),
  ].filter((s): s is string => s !== null);

  return [
    `# FinTrack export: base currency ${data.profile.currency}`,
    ...sections.flatMap((s) => [s, ""]),
  ].join("\n");
}

/**
 * Pretty-printed JSON snapshot with a small metadata envelope.
 *
 * `llmConfig` is nulled out: it holds the API key the user brought themselves,
 * and a downloaded file that lands in a sync folder or an email attachment is
 * exactly how a key escapes. Nulled rather than deleted so the snapshot keeps
 * the same shape as `PortfolioData` -- "no key configured" is a state the app
 * already has, an absent field is not.
 */
export function portfolioToJson(data: PortfolioData): string {
  const exportable: PortfolioData = { ...data, llmConfig: null };
  return JSON.stringify(
    { app: "FinTrack", version: 1, exportedAt: new Date().toISOString(), data: exportable },
    null,
    2,
  );
}

/** Trigger a client-side file download of `content`. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Whether there is anything worth downloading.
 *
 * Both export surfaces used to ask "any assets or transactions?", which was
 * true while the export only covered the depot. It stopped being true the
 * moment the file started carrying accounts, bookings, budgets, goals and the
 * pension: someone who tracks their everyday money and owns no securities had
 * a full ledger and a permanently greyed-out Export button.
 */
export function hasExportableData(data: PortfolioData): boolean {
  return (
    data.assets.length > 0 ||
    data.transactions.length > 0 ||
    data.accounts.length > 0 ||
    data.spendingTransactions.length > 0 ||
    data.savingsPlans.length > 0 ||
    data.watchlist.length > 0 ||
    data.budgets.length > 0 ||
    data.contracts.length > 0 ||
    data.plannedCashflows.length > 0 ||
    data.goals.length > 0 ||
    data.pensionPoints.length > 0 ||
    data.pensionStatements.length > 0 ||
    data.pensionContracts.length > 0
  );
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function exportPortfolioJson(data: PortfolioData): void {
  downloadFile(`fintrack-${stamp()}.json`, portfolioToJson(data), "application/json");
}

export function exportPortfolioCsv(data: PortfolioData): void {
  downloadFile(`fintrack-${stamp()}.csv`, portfolioToCsv(data), "text/csv;charset=utf-8");
}

/**
 * Advisor/Elster-prep export for one tax year (ROADMAP item #11): the
 * capital-gains waterfall (`TaxYearBreakdown`) plus deductible expenses and
 * income context from the spending ledger (`TaxPackYear`), in the profile's
 * base currency. `pack` is undefined when the spending ledger has no rows
 * for the year -- the deductible/income sections are then empty, not absent.
 */
export function taxPackYearToCsv(
  breakdown: TaxYearBreakdown,
  pack: TaxPackYear | undefined,
  currency: string,
): string {
  const capitalRows: (string | number | null)[][] = [
    ["# Capital income", breakdown.year],
    ["item", "amount", "currency"],
    ["Stock gains", breakdown.stockGains, currency],
    ["Fund gains", breakdown.fundGains, currency],
    ["Dividends (stock)", breakdown.dividendsStock, currency],
    ["Dividends (fund)", breakdown.dividendsFund, currency],
    ["Interest", breakdown.interest, currency],
    ["Vorabpauschale", breakdown.vorabpauschale, currency],
    ["Kapitalerträge (taxable pots)", breakdown.kapitalertraege, currency],
    ["Allowance used (Sparerpauschbetrag)", breakdown.allowanceUsed, currency],
    ["Taxable after allowance", breakdown.taxableAfterAllowance, currency],
    ["Estimated tax", breakdown.estimatedTax, currency],
    ["Tax withheld by broker", breakdown.taxWithheld, currency],
    ["Private sale gains (crypto/commodities, informational)", breakdown.privateSale, currency],
  ];

  const deductibleRows: (string | number | null)[][] = [
    ["# Deductible expenses", breakdown.year],
    ["group", "category", "amount", "currency"],
    ...(pack?.deductibleByCategory ?? []).map((c) => [c.groupName, c.name, c.amount, currency]),
    ["Total", "", pack?.deductibleTotal ?? 0, currency],
  ];

  const incomeRows: (string | number | null)[][] = [
    ["# Other income & expense (spending ledger)", breakdown.year],
    ["item", "amount", "currency"],
    ["Income", pack?.income ?? 0, currency],
    ["Expense", pack?.expense ?? 0, currency],
  ];

  return [
    `# FinTrack tax pack ${breakdown.year}: base currency ${currency}. Estimate for orientation only, not tax advice.`,
    toCsvRows(capitalRows),
    "",
    toCsvRows(deductibleRows),
    "",
    toCsvRows(incomeRows),
    "",
  ].join("\n");
}

export function exportTaxPackYear(
  breakdown: TaxYearBreakdown,
  pack: TaxPackYear | undefined,
  currency: string,
): void {
  downloadFile(
    `fintrack-tax-pack-${breakdown.year}.csv`,
    taxPackYearToCsv(breakdown, pack, currency),
    "text/csv;charset=utf-8",
  );
}
