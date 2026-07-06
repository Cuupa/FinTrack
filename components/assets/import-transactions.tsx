"use client";

// CSV transaction import (Add-asset modal → Import tab). Parses a broker export
// entirely in the browser, reconciles each row against the portfolio (new /
// conflict / already-imported), and lets the user resolve conflicts in an
// IntelliJ-style three-pane merge (current | result | incoming, accepting
// individual fields from either side), then creates the assets + transactions
// and records what was merged. Known German brokers parse precisely; any other
// CSV falls back to a generic header-driven parser.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { parseCsv, type ParsedTx } from "@/lib/import/csv";
import { reconcile, type ReconciledRow } from "@/lib/import/reconcile";
import { resolveOfficialNames } from "@/lib/import/resolve-names";
import { formatCurrency, formatNumber, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { AssetType, TransactionType } from "@/lib/types";

// A conflict is resolved field by field: each mergeable field takes its value
// from the existing transaction ("current") or the CSV row ("incoming"). New
// rows use a simple include/exclude instead.
const MERGE_FIELDS = ["type", "quantity", "price", "fee", "tax", "date"] as const;
type MergeField = (typeof MERGE_FIELDS)[number];
type MergeSide = "current" | "incoming";
type Resolution = Record<MergeField, MergeSide>;

function allFrom(side: MergeSide): Resolution {
  return { type: side, quantity: side, price: side, fee: side, tax: side, date: side };
}

/** The five mergeable values, whichever object they come from. */
type MergeValues = Pick<ParsedTx, MergeField>;

function isMerged(res: Resolution | undefined): boolean {
  return res != null && MERGE_FIELDS.some((f) => res[f] === "incoming");
}

/**
 * A "conflict" whose matched existing transaction is identical in every
 * mergeable field to the incoming row — the fuzzy matcher flags it, but
 * there's nothing to decide. Dates compare by day only (the matcher already
 * tolerates sub-day time differences); the other fields compare exactly.
 */
function isIdentical(row: ReconciledRow): boolean {
  const ex = row.existing;
  if (!ex) return false;
  const p = row.parsed;
  return (
    ex.type === p.type &&
    ex.quantity === p.quantity &&
    ex.price === p.price &&
    ex.fee === p.fee &&
    ex.tax === p.tax &&
    ex.date.slice(0, 10) === p.date.slice(0, 10)
  );
}

async function readFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // Fall back to Windows-1252 for latin-1 exports (umlauts came through broken).
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("windows-1252").decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/** The identifier a parsed row is priced/matched by — isin, then wkn, then symbol. */
function rowIdentifier(p: Pick<ParsedTx, "isin" | "wkn" | "symbol">): string {
  return (p.isin || p.wkn || p.symbol || "").toUpperCase();
}

/**
 * Resolve the official instrument name (and, when known, the real asset
 * type) for every unique identifier in a parsed CSV, so the preview and the
 * assets created from it show accurate data instead of whatever the broker
 * export happened to print — or, for the generic parser, had to guess from
 * the name. A row's CSV name/type is kept if neither the catalog nor the
 * live lookup resolves it (see `resolveOfficialNames`).
 */
async function resolveNames(rows: ParsedTx[]) {
  const ids = new Set<string>();
  for (const p of rows) {
    const id = rowIdentifier(p);
    if (id) ids.add(id);
  }
  return resolveOfficialNames([...ids]);
}

function txTypeColor(type: TransactionType): string {
  return type === "BUY"
    ? "text-emerald-600 dark:text-emerald-400"
    : type === "BOOKING"
      ? "text-indigo-600 dark:text-indigo-400"
      : "text-red-600 dark:text-red-400";
}

export function ImportTransactions({
  onDone,
  onRun,
}: {
  onDone?: () => void;
  /**
   * When provided, Apply hands the import work off as a promise instead of
   * running it inline: the caller (the dashboard) takes ownership of the
   * promise — e.g. closing the modal immediately and showing a floating
   * progress/result indicator — and this component unmounts right away, so
   * nothing here may touch state once the promise settles.
   */
  onRun?: (job: Promise<void>) => void;
}) {
  const {
    data,
    allTransactions,
    portfolios,
    selectedPortfolioIds,
    addAsset,
    addTransaction,
    updateTransaction,
    createPortfolio,
    loadImportedFingerprints,
    addImportedFingerprints,
  } = usePortfolio();
  const { t } = useI18n();

  const [fileName, setFileName] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<ReconciledRow[]>([]);
  // Recognised-but-cash-only rows (dividends, fees) the parser skipped.
  const [skippedCount, setSkippedCount] = useState(0);
  // Rows the parser emitted but the validation guardrail rejected (missing
  // ISIN/WKN, bad date, non-positive shares/price) — counted, never imported.
  const [invalidCount, setInvalidCount] = useState(0);
  // New rows: included by index (default all). Conflicts: per-field resolution.
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [resolutions, setResolutions] = useState<Record<number, Resolution>>({});
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [addingPortfolio, setAddingPortfolio] = useState(false);
  const [newPortfolio, setNewPortfolio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError(null);
    try {
      const text = await readFile(file);
      const { rows: parsed, skipped, invalid } = parseCsv(text);
      if (parsed.length === 0) {
        setError(t("import.noRows"));
        setReconciled([]);
        setFileName(null);
        setSkippedCount(0);
        setInvalidCount(0);
        return;
      }
      setSkippedCount(skipped);
      setInvalidCount(invalid);
      // Replace the broker's CSV name/type with the official instrument data
      // (catalog first, then a throttled live lookup) so both the preview
      // and the assets created from it are accurate, not the export's own
      // text or the generic parser's name-based type guess.
      const resolvedById = await resolveNames(parsed);
      for (const p of parsed) {
        const resolved = resolvedById.get(rowIdentifier(p));
        if (resolved?.name) p.name = resolved.name;
        if (resolved?.type) p.assetType = resolved.type;
      }
      const imported = new Set(await loadImportedFingerprints());
      const rec = reconcile(parsed, data.assets, allTransactions, imported);
      setFileName(file.name);
      setReconciled(rec);
      // Defaults: include every new row; keep the existing side for conflicts.
      const inc: Record<number, boolean> = {};
      const res: Record<number, Resolution> = {};
      rec.forEach((r, i) => {
        if (r.status === "new") inc[i] = true;
        else if (r.status === "conflict") res[i] = allFrom("current");
      });
      setIncluded(inc);
      setResolutions(res);
    } catch {
      setError(t("import.readError"));
    }
  }

  const newRows = useMemo(
    () => reconciled.map((r, i) => ({ r, i })).filter((x) => x.r.status === "new"),
    [reconciled],
  );
  const conflictAll = useMemo(
    () => reconciled.map((r, i) => ({ r, i })).filter((x) => x.r.status === "conflict"),
    [reconciled],
  );
  // Split conflicts into ones that actually need a decision and ones whose
  // matched existing transaction is byte-for-byte the same as the incoming
  // row — those get a collapsed, no-action summary instead of a merge card.
  const conflictRows = useMemo(
    () => conflictAll.filter((x) => !isIdentical(x.r)),
    [conflictAll],
  );
  const identicalRows = useMemo(
    () => conflictAll.filter((x) => isIdentical(x.r)),
    [conflictAll],
  );
  const importedCount = useMemo(
    () => reconciled.filter((r) => r.status === "imported").length,
    [reconciled],
  );

  const willApply =
    newRows.filter((x) => included[x.i]).length +
    conflictRows.filter((x) => isMerged(resolutions[x.i])).length;

  /**
   * The actual import work: creates/reuses assets, applies merges or new
   * transactions, and records fingerprints. Throws on failure, resolves on
   * success — never touches component state, so it's safe to run after this
   * component has unmounted (the `onRun` path hands this promise off to the
   * caller and closes the modal immediately).
   */
  async function runImport(): Promise<void> {
    // Cache asset ids by identifier so repeated rows reuse one asset (and
    // assets created earlier in this same import).
    const key = (isin: string | null, wkn: string | null, symbol: string | null) =>
      (isin || wkn || symbol || "").toUpperCase();
    const cache = new Map<string, string>();
    for (const a of data.assets) {
      const k = key(a.isin, a.wkn, a.symbol);
      if (k) cache.set(k, a.id);
    }

    const recorded: { fingerprint: string; transactionId: string | null }[] = [];
    for (let i = 0; i < reconciled.length; i++) {
      const r = reconciled[i];
      // Identical rows never got a merge card to act on — recording them
      // against the existing transaction they matched is what stops them
      // resurfacing as noise on the next import.
      if (r.status === "conflict" && r.existing && isIdentical(r)) {
        recorded.push({ fingerprint: r.fingerprint, transactionId: r.existing.id });
        continue;
      }
      const res = resolutions[i];
      const merge = r.status === "conflict" && r.existing && isMerged(res);
      const importNew = r.status === "new" && included[i];
      if (!merge && !importNew) continue;

      const p = r.parsed;
      const k = key(p.isin, p.wkn, p.symbol);
      let assetId = cache.get(k);
      if (!assetId) {
        const created = await addAsset({
          isin: p.isin,
          wkn: p.wkn,
          symbol: p.symbol,
          name: p.name,
          type: p.assetType as AssetType,
          currency: p.currency,
          notes: null,
        });
        assetId = created.id;
        if (k) cache.set(k, assetId);
      }
      let transactionId: string;
      if (merge && r.existing) {
        // Field-wise merge: each field comes from the side the user accepted.
        const ex = r.existing;
        const pick = <F extends MergeField>(f: F): MergeValues[F] =>
          (res[f] === "incoming" ? p : ex)[f];
        await updateTransaction(ex.id, {
          assetId,
          portfolioId: ex.portfolioId,
          type: pick("type"),
          quantity: pick("quantity"),
          price: pick("price"),
          fee: pick("fee"),
          tax: pick("tax"),
          date: pick("date"),
        });
        transactionId = ex.id;
      } else {
        const created = await addTransaction({
          assetId,
          portfolioId,
          type: p.type,
          quantity: p.quantity,
          price: p.price,
          fee: p.fee,
          tax: p.tax,
          date: p.date,
        });
        transactionId = created.id;
      }
      recorded.push({ fingerprint: r.fingerprint, transactionId });
    }
    await addImportedFingerprints(recorded);
  }

  async function apply() {
    setError(null);
    if (onRun) {
      // Start the import now and hand the promise off to the caller, which
      // takes over reporting progress/outcome. Close the modal immediately —
      // this component unmounts, so nothing below may run.
      onRun(runImport());
      onDone?.();
      return;
    }
    setBusy(true);
    try {
      await runImport();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("import.applyError"));
    } finally {
      setBusy(false);
    }
  }

  const hasFile = reconciled.length > 0;

  return (
    <div className="space-y-4">
      {/* File chooser + (once loaded) target portfolio picker with inline create. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {hasFile ? t("import.reselectFile") : t("import.selectFile")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
        </label>
        {fileName && <span className="truncate text-sm text-zinc-500">{fileName}</span>}
        {hasFile && portfolios.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-zinc-500">{t("import.portfolio")}</span>
            <div className="w-48">
              <SelectMenu
                value={portfolioId}
                ariaLabel={t("import.portfolio")}
                onChange={setPortfolioId}
                options={portfolios.map((p) => ({ value: p.id, label: p.name }))}
                footer={(close) =>
                  addingPortfolio ? (
                    <input
                      autoFocus
                      value={newPortfolio}
                      placeholder={t("nav.newPortfolio")}
                      onChange={(e) => setNewPortfolio(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          const name = newPortfolio.trim();
                          if (name) {
                            try {
                              const p = await createPortfolio(name);
                              setPortfolioId(p.id);
                            } catch {
                              /* at max portfolios — ignore */
                            }
                          }
                          setNewPortfolio("");
                          setAddingPortfolio(false);
                          close();
                        }
                        if (e.key === "Escape") {
                          setAddingPortfolio(false);
                          setNewPortfolio("");
                        }
                      }}
                      className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingPortfolio(true)}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
                    >
                      {t("nav.newPortfolio")}
                    </button>
                  )
                }
              />
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {hasFile && (
        <>
          {/* Compact counts so the shape of the import is clear before scrolling
              through any of the sections below. */}
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
            {identicalRows.length > 0 && (
              <span className="text-zinc-400">
                {identicalRows.length} {t("import.identicalSection")}
              </span>
            )}
            {importedCount > 0 && (
              <span className="text-zinc-400">
                {importedCount} {t("import.alreadyImported")}
              </span>
            )}
            {skippedCount > 0 && (
              <span className="text-zinc-400">
                {skippedCount} {t("import.skippedCash")}
              </span>
            )}
            {invalidCount > 0 && (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {invalidCount} {t("import.invalidRows")}
              </span>
            )}
          </div>

          {/* Conflicts: three-pane merge, current | result | incoming. Real
              conflicts only — rows identical to their match need no card. */}
          {conflictRows.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                {t("import.conflictSection")}{" "}
                <span className="font-normal text-zinc-400">({conflictRows.length})</span>
              </h3>
              <div className="space-y-3">
                {conflictRows.map(({ r, i }) => (
                  <ConflictMerge
                    key={i}
                    row={r}
                    resolution={resolutions[i] ?? allFrom("current")}
                    onResolution={(res) =>
                      setResolutions((prev) => ({ ...prev, [i]: res }))
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* New transactions: include/exclude with checkboxes. */}
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
                    onClick={() =>
                      setIncluded(Object.fromEntries(newRows.map((x) => [x.i, true])))
                    }
                    className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    {t("import.includeAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setIncluded(Object.fromEntries(newRows.map((x) => [x.i, false])))
                    }
                    className="font-medium text-zinc-500 hover:underline"
                  >
                    {t("import.includeNone")}
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800/60 dark:border-zinc-800">
                {newRows.map(({ r, i }) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={included[i] ?? false}
                      onChange={(e) =>
                        setIncluded((prev) => ({ ...prev, [i]: e.target.checked }))
                      }
                      className="h-4 w-4 shrink-0 rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <div className="min-w-0 flex-1">
                      <AssetLine parsed={r.parsed} />
                    </div>
                    <TxSummary parsed={r.parsed} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Identical rows: the matched existing transaction already has
              these exact values — nothing to decide, so just list them
              collapsed instead of forcing 20 merge cards with no signal. */}
          {identicalRows.length > 0 && (
            <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-zinc-500 marker:content-none">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
                {t("import.identicalSection")}{" "}
                <span className="font-normal text-zinc-400">({identicalRows.length})</span>
              </summary>
              <ul className="divide-y divide-zinc-100 border-t border-zinc-200 dark:divide-zinc-800/60 dark:border-zinc-800">
                {identicalRows.map(({ r, i }) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <AssetLine parsed={r.parsed} />
                    </div>
                    <TxSummary parsed={r.parsed} />
                  </li>
                ))}
              </ul>
            </details>
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
            <Button
              variant="primary"
              onClick={apply}
              disabled={busy || (willApply === 0 && identicalRows.length === 0)}
            >
              {busy ? t("import.importing") : t("import.apply")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function AssetLine({ parsed }: { parsed: ParsedTx }) {
  return (
    <>
      <div className="truncate font-medium">{parsed.name}</div>
      <div className="font-mono text-xs text-zinc-500">
        {parsed.isin || parsed.wkn || parsed.symbol}
      </div>
    </>
  );
}

/** Compact "TYPE qty @ price · date" summary of a parsed row. */
function TxSummary({ parsed }: { parsed: ParsedTx }) {
  const cur = parsed.currency || "EUR";
  return (
    <div className="shrink-0 text-right text-xs text-zinc-500">
      <span className={txTypeColor(parsed.type)}>{parsed.type}</span>{" "}
      {formatNumber(parsed.quantity, 4)} @ {formatCurrency(parsed.price, cur)}
      <div className="text-[11px] text-zinc-400">{formatDateTime(parsed.date)}</div>
    </div>
  );
}

/**
 * IntelliJ-style three-pane merge: current (left) | result (center) |
 * incoming (right). Each differing field is accepted into the result from
 * either side via the chevron buttons; identical fields are shown dimmed.
 */
function ConflictMerge({
  row,
  resolution,
  onResolution,
}: {
  row: ReconciledRow;
  resolution: Resolution;
  onResolution: (r: Resolution) => void;
}) {
  const { t } = useI18n();
  const p = row.parsed;
  const ex = row.existing;
  if (!ex) return null;
  const cur = p.currency || "EUR";

  const labels: Record<MergeField, string> = {
    type: t("tx.type"),
    quantity: t("tx.quantity"),
    price: t("tx.price"),
    fee: t("tx.fee"),
    tax: t("tx.tax"),
    date: t("tx.date"),
  };
  const fmt = (v: MergeValues, f: MergeField) => {
    switch (f) {
      case "type":
        return <span className={txTypeColor(v.type)}>{v.type}</span>;
      case "quantity":
        return formatNumber(v.quantity, 4);
      case "price":
        return formatCurrency(v.price, cur);
      case "fee":
        return formatCurrency(v.fee, cur);
      case "tax":
        return formatCurrency(v.tax, cur);
      case "date":
        return formatDateTime(v.date);
    }
  };
  const differs = (f: MergeField) => ex[f] !== p[f];
  const accept = (f: MergeField, side: MergeSide) =>
    onResolution({ ...resolution, [f]: side });

  const sideCls = (active: boolean, changed: boolean) =>
    `flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-sm tabular-nums ${
      changed
        ? active
          ? "bg-emerald-50 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:ring-emerald-800"
          : "bg-white dark:bg-zinc-900"
        : "text-zinc-400"
    }`;
  const chevronCls =
    "shrink-0 rounded px-1 text-zinc-400 hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-900/50 dark:hover:text-emerald-300";

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/10">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.name}</div>
          <div className="font-mono text-xs text-zinc-500">
            {p.isin || p.wkn || p.symbol}
          </div>
        </div>
        <div className="flex shrink-0 gap-3 text-xs">
          <button
            type="button"
            onClick={() => onResolution(allFrom("current"))}
            className="font-medium text-zinc-500 hover:underline"
          >
            {t("import.keepCurrent")}
          </button>
          <button
            type="button"
            onClick={() => onResolution(allFrom("incoming"))}
            className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            {t("import.useIncoming")}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[36rem] grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-3 gap-y-1">
          <div />
          <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("import.inPortfolio")}
          </div>
          <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("import.result")}
          </div>
          <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("import.fromFile")}
          </div>

          {MERGE_FIELDS.map((f) => {
            const changed = differs(f);
            const side = resolution[f];
            const chosen: MergeValues = side === "incoming" ? p : ex;
            return (
              <div key={f} className="contents">
                <div className="text-xs text-zinc-500">{labels[f]}</div>
                <div className={sideCls(side === "current", changed)}>
                  <span className="min-w-0 flex-1 truncate">{fmt(ex, f)}</span>
                  {changed && (
                    <button
                      type="button"
                      onClick={() => accept(f, "current")}
                      aria-label={`${labels[f]}: ${t("import.keepCurrent")}`}
                      className={chevronCls}
                    >
                      »
                    </button>
                  )}
                </div>
                <div
                  className={`rounded-md px-2 py-1 text-sm tabular-nums ${
                    changed && side === "incoming"
                      ? "bg-emerald-100/70 font-medium dark:bg-emerald-900/40"
                      : changed
                        ? "bg-white dark:bg-zinc-900"
                        : "text-zinc-400"
                  }`}
                >
                  {fmt(chosen, f)}
                </div>
                <div className={sideCls(side === "incoming", changed)}>
                  {changed && (
                    <button
                      type="button"
                      onClick={() => accept(f, "incoming")}
                      aria-label={`${labels[f]}: ${t("import.useIncoming")}`}
                      className={chevronCls}
                    >
                      «
                    </button>
                  )}
                  <span className="min-w-0 flex-1 truncate">{fmt(p, f)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
