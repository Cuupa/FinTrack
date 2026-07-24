// Deterministic payee -> category auto-fill (ROADMAP item #2, flag
// `spending`) — pure, no React, no lib/server imports, no ML. A rule is only
// ever learned from the user's OWN past categorisation: once a payee has
// been manually assigned a category, later transactions with the same payee
// (case/whitespace-insensitive) inherit it automatically.

import type { SpendingTransaction } from "../types";

function normalizePayee(payee: string): string {
  return payee.trim().toLowerCase();
}

/**
 * Builds payee -> categoryId rules from already-categorised transactions.
 * When a payee has been assigned more than one category historically, the
 * most recently dated transaction wins (deterministic, no majority vote).
 */
export function buildCategoryRules(transactions: SpendingTransaction[]): Map<string, string> {
  const latest = new Map<string, { categoryId: string; date: string }>();
  for (const t of transactions) {
    if (!t.categoryId) continue;
    const key = normalizePayee(t.payee);
    if (!key) continue;
    const existing = latest.get(key);
    if (!existing || t.date >= existing.date) {
      latest.set(key, { categoryId: t.categoryId, date: t.date });
    }
  }
  return new Map([...latest.entries()].map(([payee, r]) => [payee, r.categoryId]));
}

/** Looks up the auto-fill category for a payee from already-built rules. */
export function suggestCategory(payee: string, rules: Map<string, string>): string | null {
  return rules.get(normalizePayee(payee)) ?? null;
}

/**
 * Applies the learned rules to every currently-uncategorised transaction,
 * returning only the ones that got a suggestion (id + categoryId pairs) so
 * the caller can batch-update the store instead of writing one at a time.
 */
export function applyCategoryRules(
  transactions: SpendingTransaction[],
): { id: string; categoryId: string }[] {
  const rules = buildCategoryRules(transactions);
  const updates: { id: string; categoryId: string }[] = [];
  for (const t of transactions) {
    if (t.categoryId) continue;
    const suggestion = suggestCategory(t.payee, rules);
    if (suggestion) updates.push({ id: t.id, categoryId: suggestion });
  }
  return updates;
}
