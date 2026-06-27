/**
 * Data-collection bridge + parse→put→query→infer flow (C-TEST-002).
 *
 * Proves the plugin's persistence path is real end-to-end against the
 * PluginContext data API (in-memory storage seam):
 *   - CollectionAPI contract: put/get/query/count/delete + in-memory filter
 *   - namespacing at pluresdb:plugin:{pluginId}/{name}/{id}
 *   - per-plugin isolation
 *   - a realistic pipeline: parse a Chase CSV → persist Transaction docs into
 *     the fa-transactions collection → query them back → feed a confirmed
 *     history into the recurring-amount inference RULE and assert a category.
 */

import { describe, it, expect } from 'vitest';
import { makeTestContext, PLUGIN_DATA_PREFIX } from './test-context.js';
import { parseCsv, csvRowsToTransactions } from '../lib/parsers/csv.js';
import {
  FA_TRANSACTIONS_COLLECTION,
  type Transaction,
} from '../lib/transactions.js';
import { FA_ACCOUNTS_COLLECTION, type Account } from '../lib/accounts.js';
import { recurringAmountPattern } from '../rules/recurring-amount.js';
import type { InferenceInput } from '@plures/pares-radix';

describe('CollectionAPI contract via ctx.data.collection()', () => {
  it('put → get returns the stored document', async () => {
    const { ctx } = makeTestContext();
    const coll = ctx.data.collection<Account>(FA_ACCOUNTS_COLLECTION);
    const acct: Account = {
      id: 'acct-1',
      name: 'Checking',
      institution: 'Chase',
      type: 'checking',
      balance: 100,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await coll.put(acct.id, acct);
    expect(await coll.get('acct-1')).toEqual(acct);
  });

  it('namespaces records at pluresdb:plugin:{pluginId}/{name}/{id}', async () => {
    const { ctx, graph } = makeTestContext('financial-advisor');
    await ctx.data
      .collection<Account>(FA_ACCOUNTS_COLLECTION)
      .put('acct-1', {
        id: 'acct-1',
        name: 'X',
        institution: '',
        type: 'checking',
        balance: 0,
        createdAt: '',
        updatedAt: '',
      });

    const expectedKey = `${PLUGIN_DATA_PREFIX}financial-advisor/${FA_ACCOUNTS_COLLECTION}/acct-1`;
    expect(expectedKey).toBe('pluresdb:plugin:financial-advisor/fa-accounts/acct-1');
    expect(graph.store.has(expectedKey)).toBe(true);
  });

  it('query() / count() / delete() behave correctly', async () => {
    const { ctx } = makeTestContext();
    const coll = ctx.data.collection<Account>(FA_ACCOUNTS_COLLECTION);
    const base = {
      institution: '',
      type: 'checking' as const,
      balance: 0,
      createdAt: '',
      updatedAt: '',
    };

    await coll.put('a', { id: 'a', name: 'Checking', ...base });
    await coll.put('b', { id: 'b', name: 'Savings', ...base });

    expect(await coll.count()).toBe(2);
    expect((await coll.query()).map((a) => a.id).sort()).toEqual(['a', 'b']);

    const checking = await coll.query({ name: 'Checking' });
    expect(checking.map((a) => a.id)).toEqual(['a']);

    await coll.delete('a');
    expect(await coll.get('a')).toBeNull();
    expect(await coll.count()).toBe(1);
  });

  it('collections are isolated by plugin id', async () => {
    const a = makeTestContext('financial-advisor');
    const b = makeTestContext('other-plugin');
    await a.ctx.data.collection(FA_ACCOUNTS_COLLECTION).put('x', { id: 'x' });

    // Different plugin, different in-memory graph → no cross-read.
    expect(await b.ctx.data.collection(FA_ACCOUNTS_COLLECTION).get('x')).toBeNull();
    expect(await b.ctx.data.collection(FA_ACCOUNTS_COLLECTION).count()).toBe(0);
  });

  it('collection(name) is memoised per name', () => {
    const { ctx } = makeTestContext();
    const c1 = ctx.data.collection(FA_ACCOUNTS_COLLECTION);
    const c2 = ctx.data.collection(FA_ACCOUNTS_COLLECTION);
    expect(c1).toBe(c2);
    expect(ctx.data.collection(FA_TRANSACTIONS_COLLECTION)).not.toBe(c1);
  });
});

describe('parse → put → query → infer pipeline', () => {
  const CHASE_CSV = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '03/01/2026,03/02/2026,NETFLIX.COM,Entertainment,Sale,-15.99,',
    '03/05/2026,03/06/2026,Whole Foods,Groceries,Sale,-82.40,',
    '03/15/2026,03/16/2026,Paycheck ACME,Income,Credit,2500.00,',
  ].join('\n');

  it('parses a Chase CSV, persists transactions, and queries them back', async () => {
    const { ctx } = makeTestContext();
    const accountId = 'acct-chk';

    const parsed = parseCsv(CHASE_CSV);
    expect(parsed.format).toBe('chase');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.skipped).toBe(0);

    const drafts = await csvRowsToTransactions(parsed.rows, 'csv');
    const coll = ctx.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION);
    const importedAt = new Date().toISOString();

    for (const draft of drafts) {
      const txn: Transaction = { ...draft, accountId, importedAt };
      await coll.put(txn.id, txn);
    }

    const stored = await coll.query();
    expect(stored).toHaveLength(3);

    // Raw amounts preserved immutably through the round-trip.
    const netflix = stored.find((t) => t.description === 'NETFLIX.COM');
    expect(netflix?.amount).toBe(-15.99);
    expect(netflix?.type).toBe('debit');
    expect(netflix?.hash).toBeTruthy();

    const paycheck = stored.find((t) => t.description === 'Paycheck ACME');
    expect(paycheck?.amount).toBe(2500);
    expect(paycheck?.type).toBe('credit');

    // Every persisted doc carries the account linkage.
    expect(stored.every((t) => t.accountId === accountId)).toBe(true);
  });

  it('feeds confirmed history into the recurring-amount rule → category inference', () => {
    // Two prior confirmed NETFLIX categorizations at ~the same amount.
    const input: InferenceInput = {
      record: { description: 'NETFLIX.COM', amount: -15.99 },
      confirmedInferences: [
        { field: 'category', value: 16.0, sourceId: 'netflix com' },
        { field: 'category', value: 15.98, sourceId: 'netflix com' },
      ],
    };

    const result = recurringAmountPattern.evaluate(input);

    expect(result).not.toBeNull();
    expect(result?.field).toBe('category');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result?.reasoning).toContain('netflix');
  });

  it('recurring-amount rule returns null without enough confirmed history', () => {
    const input: InferenceInput = {
      record: { description: 'NETFLIX.COM', amount: -15.99 },
      confirmedInferences: [{ field: 'category', value: 16.0, sourceId: 'netflix com' }],
    };
    expect(recurringAmountPattern.evaluate(input)).toBeNull();
  });
});
