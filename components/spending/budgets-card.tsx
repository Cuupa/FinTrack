"use client";

// Monthly per-category budget caps + budget-vs-actual bars (ROADMAP #4, flag
// `budgets`) -- "category caps + flow", not YNAB-style envelopes. One budget
// per category; category totals are converted to the base currency before
// comparing against the cap (toBaseCurrency in lib/finance/spending.ts), the
// same convention the ledger totals and cash-flow Sankey already use.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { today } from "@/lib/finance/dates";
import { budgetProgress, toBaseCurrency } from "@/lib/finance/spending";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { colorForLabel } from "@/lib/colors";
import { Button, Card, EmptyState, Field, Input } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";
import type { Budget } from "@/lib/types";

/**
 * The card is self-gated: hidden when the flag is off, and — when the flag is
 * on but the feature requires Pro on a free plan — rendered blurred and inert
 * behind the paywall message instead of disappearing (MONETIZATION.md Phase 3).
 */
export function BudgetsCard({ month = null }: { month?: string | null }) {
  const { enabled, locked } = useFeature("budgets");
  if (!enabled) return null;
  if (locked)
    return (
      <ProTeaser feature="budgets">
        <BudgetsCardInner month={month} />
      </ProTeaser>
    );
  return <BudgetsCardInner month={month} />;
}

function BudgetsCardInner({ month: selected }: { month: string | null }) {
  const { data, addBudget, updateBudget, deleteBudget } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t, locale } = useI18n();
  const base = data.profile.currency;

  const month = selected ?? today().slice(0, 7);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const categoriesById = useMemo(
    () => new Map(data.spendingCategories.map((c) => [c.id, c])),
    [data.spendingCategories],
  );

  const converted = useMemo(
    () => toBaseCurrency(data.spendingTransactions, data.accounts, base, valuation.fx),
    [data.spendingTransactions, data.accounts, base, valuation.fx],
  );

  const progress = useMemo(
    () => budgetProgress(converted, data.budgets, month),
    [converted, data.budgets, month],
  );

  const availableCategories = useMemo(() => {
    const budgeted = new Set(data.budgets.map((b) => b.categoryId));
    return data.spendingCategories.filter((c) => !budgeted.has(c.id));
  }, [data.spendingCategories, data.budgets]);

  function categoryLabel(id: string): string {
    const c = categoriesById.get(id);
    return c ? `${c.groupName} · ${c.name}` : t("spending.list.uncategorized");
  }

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
      new Date(Date.UTC(y, m - 1, 1)),
    );
  }, [month, locale]);

  function reportError(err: unknown) {
    setError(isStorageFullError(err) ? t("common.storageFull") : t("spending.budgets.error"));
  }

  async function submit() {
    const value = parseDecimal(amount);
    if (!categoryId || !Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await addBudget({ categoryId, amount: value });
      setCategoryId("");
      setAmount("");
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(b: Budget) {
    setEditingId(b.id);
    setEditAmount(String(b.amount));
  }

  async function commitEdit(id: string) {
    const value = parseDecimal(editAmount);
    setEditingId(null);
    if (!Number.isFinite(value) || value <= 0) return;
    try {
      await updateBudget(id, { amount: value });
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("spending.budgets.title")}</h2>
        {/* The month comes from the page header now, but a cap is always read
            against one, so name the month these bars measure. */}
        <span className="text-sm font-medium text-zinc-500">{monthLabel}</span>
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {data.spendingCategories.length === 0 ? (
        // No categories at all: the whole card body is this state (no add-form
        // below, since a budget needs a category first), so it earns the full
        // EmptyState. The "no budgets yet" case keeps an inline hint -- its add
        // form still renders directly beneath it.
        <EmptyState
          className="py-8"
          title={t("spending.budgets.noCategoriesTitle")}
          hint={t("spending.budgets.noCategories")}
        />
      ) : (
        <>
          {progress.length === 0 ? (
            <p className="mt-3 text-sm text-tertiary">{t("spending.budgets.empty")}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {progress.map((p) => {
                const label = categoryLabel(p.categoryId);
                const pct = p.cap > 0 ? Math.min(100, (p.spent / p.cap) * 100) : 0;
                const color = p.overBudget ? "#ef4444" : colorForLabel(label);
                return (
                  <li key={p.budgetId}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{label}</span>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        {editingId === p.budgetId ? (
                          <input
                            autoFocus
                            inputMode="decimal"
                            value={editAmount}
                            onChange={(e) => setEditAmount(stripLeadingZero(e.target.value))}
                            onBlur={() => void commitEdit(p.budgetId)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-24 rounded-sm border border-zinc-300 bg-transparent px-2 py-0.5 text-right text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                            data-private={editAmount !== "" ? "" : undefined}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit({ id: p.budgetId, categoryId: p.categoryId, amount: p.cap })}
                            className="tabular-nums text-zinc-500 hover:underline"
                            data-private
                          >
                            {formatCurrency(p.spent, base)} / {formatCurrency(p.cap, base)}
                          </button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            setDeleting({ id: p.budgetId, categoryId: p.categoryId, amount: p.cap })
                          }
                        >
                          {t("spending.categories.delete")}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                    {p.overBudget && (
                      <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                        {t("spending.budgets.overBudget", { amount: formatCurrency(-p.remaining, base) })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-3 dark:border-zinc-800">
            <Field label={t("spending.budgets.categoryLabel")} className="sm:col-span-2">
              <SelectMenu
                className="mt-1 w-full"
                ariaLabel={t("spending.budgets.categoryLabel")}
                value={categoryId}
                onChange={setCategoryId}
                searchable
                options={availableCategories.map((c) => ({
                  value: c.id,
                  label: c.name,
                  group: c.groupName,
                }))}
              />
            </Field>
            <Field label={t("spending.budgets.amountLabel", { currency: base })} htmlFor="budget-amount">
              <Input
                id="budget-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
                placeholder="0"
                data-private={amount !== "" ? "" : undefined}
              />
            </Field>
            <div className="sm:col-span-3">
              <Button
                variant="primary"
                disabled={busy || !categoryId || !amount.trim() || availableCategories.length === 0}
                onClick={() => void submit()}
              >
                {t("spending.budgets.add")}
              </Button>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t("spending.budgets.delete")}
        message={deleting ? t("spending.budgets.deleteConfirm", { name: categoryLabel(deleting.categoryId) }) : undefined}
        confirmLabel={t("spending.budgets.delete")}
        onConfirm={() => {
          if (deleting) void deleteBudget(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}
