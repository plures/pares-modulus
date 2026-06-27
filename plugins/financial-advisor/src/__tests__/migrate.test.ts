/**
 * migrate.ts — idempotent localStorage→PluresDB migration (C-TEST-002).
 *
 * Exercises the real migration against a real PluginContext (in-memory storage
 * seam) and an in-memory localStorage shim. Asserts:
 *   - legacy fa_* arrays are seeded into the matching collections
 *   - running twice produces NO duplicates (idempotent) and leaves the flag set
 *   - the migration flag short-circuits subsequent runs
 *   - records written post-migration are NOT clobbered (collision-safe)
 *   - unparseable / non-array legacy blobs are skipped without throwing
 *   - SSR (no window) is a safe no-op
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  makeTestContext,
  installLocalStorageShim,
  clearLocalStorageShim,
} from './test-context.js';
import { migrateLocalStorageToPluresDB, FA_MIGRATION_FLAG } from '../lib/migrate.js';
import { FA_ACCOUNTS_COLLECTION, type Account } from '../lib/accounts.js';
import { FA_GOALS_COLLECTION, type Goal } from '../lib/goals.js';
import { FA_BUDGETS_COLLECTION } from '../lib/budgets.js';
import { FA_TRANSACTIONS_COLLECTION } from '../lib/transactions.js';

const sampleAccounts: Account[] = [
  {
    id: 'acct-1',
    name: 'Checking',
    institution: 'Chase',
    type: 'checking',
    balance: 1234.56,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'acct-2',
    name: 'Savings',
    institution: 'Ally',
    type: 'savings',
    balance: 5000,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

const sampleGoals: Goal[] = [
  {
    id: 'goal-1',
    name: 'Emergency Fund',
    targetAmount: 10000,
    currentAmount: 2500,
    isCompleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

afterEach(() => {
  clearLocalStorageShim();
});

describe('migrateLocalStorageToPluresDB — idempotency & correctness', () => {
  it('seeds legacy fa_* arrays into their collections and sets the flag', async () => {
    installLocalStorageShim({
      fa_accounts: JSON.stringify(sampleAccounts),
      fa_goals: JSON.stringify(sampleGoals),
    });
    const { ctx } = makeTestContext();

    await migrateLocalStorageToPluresDB(ctx);

    const accounts = await ctx.data.collection<Account>(FA_ACCOUNTS_COLLECTION).query();
    const goals = await ctx.data.collection<Goal>(FA_GOALS_COLLECTION).query();

    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.id).sort()).toEqual(['acct-1', 'acct-2']);
    expect(goals).toHaveLength(1);
    expect(goals[0]?.name).toBe('Emergency Fund');

    expect(window.localStorage.getItem(FA_MIGRATION_FLAG)).toBe('done');
  });

  it('is idempotent: running twice produces no duplicates', async () => {
    installLocalStorageShim({
      fa_accounts: JSON.stringify(sampleAccounts),
    });
    const { ctx } = makeTestContext();

    await migrateLocalStorageToPluresDB(ctx);
    await migrateLocalStorageToPluresDB(ctx); // second run must be a no-op

    const coll = ctx.data.collection<Account>(FA_ACCOUNTS_COLLECTION);
    expect(await coll.count()).toBe(2);
    expect((await coll.query()).map((a) => a.id).sort()).toEqual(['acct-1', 'acct-2']);
  });

  it('the flag short-circuits migration even if new legacy data appears', async () => {
    installLocalStorageShim({ fa_accounts: JSON.stringify([sampleAccounts[0]]) });
    const { ctx } = makeTestContext();

    await migrateLocalStorageToPluresDB(ctx);
    expect(await ctx.data.collection(FA_ACCOUNTS_COLLECTION).count()).toBe(1);

    // Simulate stale legacy data being written after the flag is set.
    window.localStorage.setItem('fa_accounts', JSON.stringify(sampleAccounts));
    await migrateLocalStorageToPluresDB(ctx);

    // Still 1 — the done flag prevents re-import.
    expect(await ctx.data.collection(FA_ACCOUNTS_COLLECTION).count()).toBe(1);
  });

  it('is collision-safe: never clobbers a record written after migration', async () => {
    installLocalStorageShim({ fa_accounts: JSON.stringify(sampleAccounts) });
    const { ctx } = makeTestContext();
    const coll = ctx.data.collection<Account>(FA_ACCOUNTS_COLLECTION);

    // Pre-seed acct-1 with an EDITED balance (as if written post-migration).
    const edited: Account = { ...sampleAccounts[0], balance: 99999 };
    await coll.put(edited.id, edited);

    // Reset the flag scenario: migration runs with the legacy (old balance) data.
    await migrateLocalStorageToPluresDB(ctx);

    const got = await coll.get('acct-1');
    expect(got?.balance).toBe(99999); // edited value preserved, not overwritten
    // acct-2 (absent before) is still seeded.
    expect(await coll.get('acct-2')).not.toBeNull();
  });

  it('skips unparseable and non-array legacy blobs without throwing', async () => {
    installLocalStorageShim({
      fa_accounts: '{not valid json',
      fa_budgets: JSON.stringify({ not: 'an array' }),
      fa_goals: JSON.stringify(sampleGoals),
    });
    const { ctx } = makeTestContext();

    await expect(migrateLocalStorageToPluresDB(ctx)).resolves.toBeUndefined();

    expect(await ctx.data.collection(FA_ACCOUNTS_COLLECTION).count()).toBe(0);
    expect(await ctx.data.collection(FA_BUDGETS_COLLECTION).count()).toBe(0);
    expect(await ctx.data.collection(FA_GOALS_COLLECTION).count()).toBe(1);
    expect(window.localStorage.getItem(FA_MIGRATION_FLAG)).toBe('done');
  });

  it('skips records lacking a string id', async () => {
    installLocalStorageShim({
      fa_transactions: JSON.stringify([
        { id: 'txn-1', amount: -5 },
        { amount: -10 }, // no id → skipped
        { id: 42, amount: -20 }, // non-string id → skipped
      ]),
    });
    const { ctx } = makeTestContext();

    await migrateLocalStorageToPluresDB(ctx);

    expect(await ctx.data.collection(FA_TRANSACTIONS_COLLECTION).count()).toBe(1);
  });

  it('no window (SSR) is a safe no-op', async () => {
    clearLocalStorageShim(); // ensure no window
    const { ctx } = makeTestContext();
    await expect(migrateLocalStorageToPluresDB(ctx)).resolves.toBeUndefined();
    expect(await ctx.data.collection(FA_ACCOUNTS_COLLECTION).count()).toBe(0);
  });

  it('leaves legacy keys in place for rollback safety', async () => {
    installLocalStorageShim({ fa_accounts: JSON.stringify(sampleAccounts) });
    const { ctx } = makeTestContext();

    await migrateLocalStorageToPluresDB(ctx);

    // Legacy key intentionally retained.
    expect(window.localStorage.getItem('fa_accounts')).not.toBeNull();
  });
});
