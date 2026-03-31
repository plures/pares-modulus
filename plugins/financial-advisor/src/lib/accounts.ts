/**
 * Account types and helpers for the fa-accounts PluresDB collection.
 */

export type AccountType = 'checking' | 'savings' | 'credit' | 'investment';

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export const FA_ACCOUNTS_COLLECTION = 'fa-accounts';

export function generateAccountId(): string {
  return `acct-${crypto.randomUUID()}`;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit Card',
  investment: 'Investment',
};

export const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  checking: '🏦',
  savings: '💰',
  credit: '💳',
  investment: '📈',
};
