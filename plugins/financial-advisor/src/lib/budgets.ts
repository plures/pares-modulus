/**
 * Budget types and helpers for the fa-budgets PluresDB collection.
 *
 * Budgets define monthly spending limits per category. Actual spending is
 * derived by querying fa-transactions (negative amounts = debits) for the
 * current and prior month and joining with fa-transaction-inferences to
 * resolve the category for each transaction.
 */

export interface Budget {
  id: string;
  /** Must match a category recognised by the transaction inference engine. */
  category: string;
  /** Maximum allowed spend for this category per calendar month (positive). */
  monthlyLimit: number;
  /**
   * Fraction of monthlyLimit at which a yellow "near-budget" warning is shown.
   * E.g. 0.8 means warn when spending reaches 80% of the limit.
   * Must be in the range (0, 1].
   */
  alertThreshold: number;
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
}

export const FA_BUDGETS_COLLECTION = 'fa-budgets';

export function generateBudgetId(): string {
  return `budget-${crypto.randomUUID()}`;
}

// ── Status helpers ────────────────────────────────────────────────────────────

export type BudgetStatus = 'ok' | 'warning' | 'over';

/** Compute the traffic-light status for a budget given the actual spend. */
export function budgetStatus(budget: Budget, actual: number): BudgetStatus {
  if (actual >= budget.monthlyLimit) return 'over';
  if (actual >= budget.monthlyLimit * budget.alertThreshold) return 'warning';
  return 'ok';
}

/** Return the spend percentage clamped to [0, 100]. */
export function spendPercent(budget: Budget, actual: number): number {
  if (budget.monthlyLimit <= 0) return 0;
  return Math.min((actual / budget.monthlyLimit) * 100, 100);
}

// ── Month helpers ─────────────────────────────────────────────────────────────

/** Returns the YYYY-MM prefix for the current calendar month. */
export function currentMonthPrefix(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Returns the YYYY-MM prefix for the previous calendar month. */
export function previousMonthPrefix(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Human-readable month label, e.g. "Apr 2026". */
export function monthLabel(prefix: string): string {
  const [year, month] = prefix.split('-');
  return new Date(`${year}-${month}-01T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
