/**
 * Unified store for Financial Advisor plugin
 * 
 * Provides localStorage-backed reactive stores for accounts, transactions, budgets, and goals.
 * Future: Replace with PluresDB collections when plugin data API is available.
 */

import type { Account } from './accounts';
import type { Transaction } from './transactions';
import type { Budget } from './budgets';
import type { Goal } from './goals';

// Storage keys
const STORAGE_KEYS = {
  accounts: 'fa_accounts',
  transactions: 'fa_transactions',
  budgets: 'fa_budgets',
  goals: 'fa_goals',
} as const;

// Generic localStorage helpers
function loadFromStorage<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = window.localStorage.getItem(key);
    return data ? (JSON.parse(data) as T[]) : [];
  } catch (error) {
    console.error(`Failed to load ${key} from localStorage:`, error);
    return [];
  }
}

function saveToStorage<T>(key: string, items: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch (error) {
    console.error(`Failed to save ${key} to localStorage:`, error);
    throw new Error('Storage quota exceeded or localStorage is disabled');
  }
}

// Account operations
export function getAccounts(): Account[] {
  return loadFromStorage<Account>(STORAGE_KEYS.accounts);
}

export function saveAccount(account: Account): Account {
  const accounts = getAccounts();
  const index = accounts.findIndex(a => a.id === account.id);
  
  if (index >= 0) {
    accounts[index] = account;
  } else {
    accounts.push(account);
  }
  
  saveToStorage(STORAGE_KEYS.accounts, accounts);
  return account;
}

export function deleteAccount(id: string): boolean {
  const accounts = getAccounts();
  const filtered = accounts.filter(a => a.id !== id);
  saveToStorage(STORAGE_KEYS.accounts, filtered);
  return true;
}

// Transaction operations
export function getTransactions(): Transaction[] {
  return loadFromStorage<Transaction>(STORAGE_KEYS.transactions);
}

export function saveTransaction(transaction: Transaction): Transaction {
  const transactions = getTransactions();
  const index = transactions.findIndex(t => t.id === transaction.id);
  
  if (index >= 0) {
    transactions[index] = transaction;
  } else {
    transactions.push(transaction);
  }
  
  saveToStorage(STORAGE_KEYS.transactions, transactions);
  return transaction;
}

export function getTransactionsByAccount(accountId: string): Transaction[] {
  const transactions = getTransactions();
  return transactions.filter(t => t.accountId === accountId);
}

// Budget operations
export function getBudgets(): Budget[] {
  return loadFromStorage<Budget>(STORAGE_KEYS.budgets);
}

export function saveBudget(budget: Budget): Budget {
  const budgets = getBudgets();
  const index = budgets.findIndex(b => b.id === budget.id);
  
  if (index >= 0) {
    budgets[index] = budget;
  } else {
    budgets.push(budget);
  }
  
  saveToStorage(STORAGE_KEYS.budgets, budgets);
  return budget;
}

export function deleteBudget(id: string): boolean {
  const budgets = getBudgets();
  const filtered = budgets.filter(b => b.id !== id);
  saveToStorage(STORAGE_KEYS.budgets, filtered);
  return true;
}

// Goal operations
export function getGoals(): Goal[] {
  return loadFromStorage<Goal>(STORAGE_KEYS.goals);
}

export function saveGoal(goal: Goal): Goal {
  const goals = getGoals();
  const index = goals.findIndex(g => g.id === goal.id);
  
  if (index >= 0) {
    goals[index] = goal;
  } else {
    goals.push(goal);
  }
  
  saveToStorage(STORAGE_KEYS.goals, goals);
  return goal;
}

export function deleteGoal(id: string): boolean {
  const goals = getGoals();
  const filtered = goals.filter(g => g.id !== id);
  saveToStorage(STORAGE_KEYS.goals, filtered);
  return true;
}
