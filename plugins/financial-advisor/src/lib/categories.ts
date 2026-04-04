/**
 * Shared category constants for the financial-advisor plugin.
 *
 * TRANSACTION_CATEGORIES is the complete list used by the inference engine and
 * the Transactions page (includes income/transfer/refund as non-spend types).
 *
 * BUDGET_CATEGORIES is the subset that makes sense for spending budgets
 * (income, transfers, and refunds are excluded).
 */

export const TRANSACTION_CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Shopping',
  'Entertainment',
  'Travel',
  'Transportation',
  'Utilities',
  'Healthcare',
  'Insurance',
  'Housing',
  'Subscriptions',
  'Education',
  'Income',
  'Transfer',
  'Refund',
  'Other',
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export const BUDGET_CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Shopping',
  'Entertainment',
  'Travel',
  'Transportation',
  'Utilities',
  'Healthcare',
  'Insurance',
  'Housing',
  'Subscriptions',
  'Education',
  'Other',
] as const;

export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
