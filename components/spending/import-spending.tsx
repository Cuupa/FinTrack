"use client";

// Bank-statement CSV import (ROADMAP item #3, flag `spending`, same flag as
// the rest of the spending surface): parses a bank export entirely in the
// browser, reconciles each row against the target account's own spending
// transactions (new / conflict / already-imported), lets the user
// include/exclude new rows and pick a category (auto-suggested from the
// user's own past categorisation via lib/finance/categorize.ts), resolve
// conflicts with a simple skip/import-anyway toggle (no field-level merge --
// a same-day same-amount match differs in payee/note wording at most, not in
// the money), then creates the transactions and records what was imported.
// Mirrors components/assets/import-transactions.tsx's shape over the
// spending row shape.

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { parseSpendingCsv, type ParsedSpendingRow } from "@/lib/import/spending-csv";
import { reconcileSpending, type ReconciledSpendingRow } from "@/lib/import/spending-reconcile";
import { buildCategoryRules, suggestCategory } from "@/lib/finance/categorize";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

type ConflictAction = "skip" | "import";

async function readFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("windows-1252").decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export function ImportSpending({ onDone }: { onDone?: () => void }) {
  const {
    data,
    addSpendingTransaction,
    loadImportedSpendingFingerprints,
    addImportedSpendingFingerprints,
  } = usePortfolio();
  const { t } = useI18n();

  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedSpendingRow[] | null>(null);
  const [invalidCount, setInvalidCount] = useState(0);
  const [reconciled, setReconciled] = useState<ReconciledSpendingRow[]>([]);
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [conflictAction, setConflictAction] = useState<Record<number, ConflictAction>>({});
  const [rowCategory, setRowCategory] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reconcileWithAccount(rows: ParsedSpendingRow[], accId: string) {
    const imported = new Set(await loadImportedSpendingFingerprints());
    const rec = reconcileSpending(rows, accId, data.spendingTransactions, imported);
    const rules = buildCategoryRules(data.spendingTransactions);
    const inc: Record<number, boolean> = {};
    const act: Record<number, ConflictAction> = {};
    const cat: Record<number, string> = {};
    rec.forEach((r, i) => {
      if (r.status === "new") {
        inc[i] = true;
        cat[i] = suggestCategory(r.parsed.payee, rules) ?? "";
      } else if (r.status === "conflict") {
        act[i] = "skip";
      }
    });
    setReconciled(rec);
    setIncluded(inc);
    setConflictAction(act);
    setRowCategory(cat);
  }

  async function onFile(file: File) {
    setError(null);
    try {
      const text = await readFile(file);
      const { rows, invalid } = parseSpendingCsv(text);
      if (rows.length === 0) {
        setError(t("spending.import.noRows"));
        setParsedRows(null);
        setReconciled([]);
        setFileName(null);
        setInvalidCount(0);
        return;
      }
      setInvalidCount(invalid);
      setFileName(file.name);
      setParsedRows(rows);
      await reconcileWithAccount(rows, accountId);
    } catch {
      setError(t("import.readError"));
    }
  }

  function onAccountChange(id: string) {
    setAccountId(id);
    if (parsedRows) void reconcileWithAccount(parsedRows, id);
  }

  const newRows = reconciled.map((r, i) => ({ r, i })).filter((x) => x.r.status === "new");
  const conflictRows = reconciled.map((r, i) => ({ r, i })).filter((x) => x.r.status === "conflict");
  const importedCount = reconciled.filter((r) => r.status === "imported").length;
  const willApply =
    newRows.filter((x) => included[x.i]).length +
    conflictRows.filter((x) => conflictAction[x.i] === "import").length;

  async function apply() {
    setError(null);
    setBusy(true);
    try {
      const recorded: { fingerprint: string; spendingTransactionId: string | null }[] = [];
      for (let i = 0; i < reconciled.length; i++) {
        const r = reconciled[i];
        if (r.status === "imported") continue;
        if (r.status === "new" && !included[i]) continue;
        if (r.status === "conflict" && conflictAction[i] !== "import") {
          if (r.existing) recorded.push({ fingerprint: r.fingerprint, spendingTransactionId: r.existing.id });
          continue;
        }
        const p = r.parsed;
        const created = await addSpendingTransaction({
          accountId,
          categoryId: rowCategory[i] || null,
          date: p.date,
          amount: p.amount,
          payee: p.payee,
          note: p.note,
          recurringId: null,
        });
        recorded.push({ fingerprint: r.fingerprint, spendingTransactionId: created.id });
      }
      await addImportedSpendingFingerprints(recorded);
      onDone?.();
    } catch (e) {
      setError(
        isStorageFullError(e) ? t("common.storageFull") : t("import.applyError"),
      );
    } finally {
      setBusy(false);
    }
  }

  const hasFile = parsedRows !== null;

  if (data.accounts.length === 0) {
    return <p className="text-sm text-zinc-500">{t("spending.form.noAccounts")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {hasFile ? t("import.reselectFile") : t("import.selectFile")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {fileName && <span className="truncate text-sm text-zinc-500">{fileName}</span>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-zinc-500">{t("spending.form.accountLabel")}</span>
          <div className="w-48">
            <SelectMenu
              value={accountId}
              ariaLabel={t("spending.form.accountLabel")}
              onChange={onAccountChange}
              options={data.accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
          </div>
        </div>
      </div>

      {!hasFile && <p className="text-sm text-zinc-500">{t("spending.import.hint")}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {hasFile && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {newRows.length > 0 && (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {newRows.length} {t("import.new")}
              </span>
            )}
            {conflictRows.length > 0 && (
              <span className="font-medium text-amber-700 dark:text-amber-300">
                {conflictRows.length} {t("import.conflicts")}
              </span>
            )}
            {importedCount > 0 && (
              <span className="text-zinc-400">
                {importedCount} {t("import.alreadyImported")}
              </span>
            )}
            {invalidCount > 0 && (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {invalidCount} {t("spending.import.invalidRows")}
              </span>
            )}
          </div>

          {conflictRows.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                {t("import.conflictSection")}{" "}
                <span className="font-normal text-zinc-400">({conflictRows.length})</span>
              </h3>
              <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {conflictRows.map(({ r, i }) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" data-private>
                        {r.parsed.payee}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {formatDate(r.parsed.date)} ·{" "}
                        <span data-private>{formatCurrency(r.parsed.amount, data.profile.currency)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setConflictAction((prev) => ({ ...prev, [i]: "skip" }))}
                        className={
                          (conflictAction[i] ?? "skip") === "skip"
                            ? "font-medium text-zinc-800 underline dark:text-zinc-100"
                            : "font-medium text-zinc-500 hover:underline"
                        }
                      >
                        {t("spending.import.skipDuplicate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConflictAction((prev) => ({ ...prev, [i]: "import" }))}
                        className={
                          conflictAction[i] === "import"
                            ? "font-medium text-emerald-600 underline dark:text-emerald-400"
                            : "font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                        }
                      >
                        {t("spending.import.importAnyway")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {newRows.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {t("import.newSection")}{" "}
                  <span className="font-normal text-zinc-400">({newRows.length})</span>
                </h3>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setIncluded(Object.fromEntries(newRows.map((x) => [x.i, true])))}
                    className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    {t("import.includeAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncluded(Object.fromEntries(newRows.map((x) => [x.i, false])))}
                    className="font-medium text-zinc-500 hover:underline"
                  >
                    {t("import.includeNone")}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800/60 dark:border-zinc-800">
                {newRows.map(({ r, i }) => (
                  <div key={i} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={included[i] ?? false}
                      onChange={(e) => setIncluded((prev) => ({ ...prev, [i]: e.target.checked }))}
                      className="h-4 w-4 shrink-0 rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" data-private>
                        {r.parsed.payee}
                      </div>
                      <div className="text-xs text-zinc-500">{formatDate(r.parsed.date)}</div>
                    </div>
                    <div className="w-44 shrink-0">
                      <SelectMenu
                        ariaLabel={t("spending.form.categoryLabel")}
                        value={rowCategory[i] ?? ""}
                        onChange={(v) => setRowCategory((prev) => ({ ...prev, [i]: v }))}
                        searchable
                        options={[
                          { value: "", label: t("spending.form.categoryNone") },
                          ...data.spendingCategories.map((c) => ({
                            value: c.id,
                            label: `${c.groupName} · ${c.name}`,
                          })),
                        ]}
                      />
                    </div>
                    <div
                      className={`w-24 shrink-0 text-right text-sm tabular-nums ${
                        r.parsed.amount < 0 ? "text-red-600 dark:text-red-400" : ""
                      }`}
                      data-private
                    >
                      {formatCurrency(r.parsed.amount, data.profile.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {importedCount > 0 && (
            <p className="text-xs text-zinc-400">
              {importedCount} {t("import.alreadyImported")}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <span className="text-sm text-zinc-500">
              {willApply} {t("import.willImport")}
            </span>
            <Button variant="primary" onClick={() => void apply()} disabled={busy || willApply === 0}>
              {busy ? t("import.importing") : t("import.apply")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
