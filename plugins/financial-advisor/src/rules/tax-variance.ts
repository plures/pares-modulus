/**
 * Tax Variance Detection Rule
 *
 * When recurring charges increase by a consistent small percentage
 * across multiple vendors simultaneously, it's likely a tax rate
 * change — not a price change. The category should be inherited.
 */

import type { InferenceRule, InferenceInput } from '@plures/pares-radix';

/** Maximum percentage increase to consider as tax variance */
const MAX_TAX_VARIANCE = 0.08; // 8%
/** Minimum number of vendors showing the same increase pattern */
const MIN_CORRELATED_VENDORS = 2;

export const taxVarianceDetection: InferenceRule = {
  id: 'fa-tax-variance',
  name: 'Tax Variance Detection',
  description: 'Detects consistent small % increases across recurring charges — likely tax rate changes',
  appliesTo: ['transaction'],
  baseConfidence: 0.80,

  evaluate(input: InferenceInput) {
    const { record, history, confirmedInferences } = input;
    const amount = record.amount as number;
    const description = normalize(record.description as string);
    const date = new Date(record.date as string);

    if (amount <= 0) return null;

    // Find previous transactions from this vendor
    const vendorHistory = (history as Array<Record<string, unknown>>)
      .filter(h => {
        const hDesc = normalize(h.description as string);
        return vendorMatch(description, hDesc) && (h.amount as number) > 0;
      })
      .sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());

    if (vendorHistory.length === 0) return null;

    const prevAmount = vendorHistory[0].amount as number;
    const pctChange = (amount - prevAmount) / prevAmount;

    // Not a tax variance if decrease or too large
    if (pctChange <= 0 || pctChange > MAX_TAX_VARIANCE) return null;

    // Check if other vendors show similar percentage increase in the same time window
    const windowStart = new Date(date.getTime() - 45 * 24 * 60 * 60 * 1000); // 45 days
    const otherVendorChanges = findCorrelatedChanges(
      history as Array<Record<string, unknown>>,
      pctChange,
      windowStart,
      date,
      description,
    );

    if (otherVendorChanges < MIN_CORRELATED_VENDORS) return null;

    // Find category from confirmed inference on previous transaction
    const prevId = vendorHistory[0].id as string;
    const categoryInf = confirmedInferences.find(
      inf => inf.field === 'category' && inf.sourceId === prevId,
    );

    if (!categoryInf) return null;

    return {
      field: 'category',
      value: categoryInf.value,
      confidence: Math.min(0.92, this.baseConfidence + otherVendorChanges * 0.04),
      reasoning: `Amount increased ${(pctChange * 100).toFixed(1)}% ($${prevAmount.toFixed(2)} → $${amount.toFixed(2)}). ${otherVendorChanges + 1} vendors show similar increase pattern within 45 days — likely a tax rate change. Category "${categoryInf.value}" inherited from previous transaction.`,
    };
  },
};

function normalize(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function vendorMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const wordsA = a.split(' ').filter(w => w.length > 2);
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2));
  const overlap = wordsA.filter(w => wordsB.has(w)).length;
  return overlap >= 1 && overlap / Math.max(wordsA.length, wordsB.size) >= 0.6;
}

function findCorrelatedChanges(
  history: Array<Record<string, unknown>>,
  targetPctChange: number,
  windowStart: Date,
  windowEnd: Date,
  excludeVendor: string,
): number {
  const tolerance = 0.015; // ±1.5% tolerance for "same" tax change
  const vendorsSeen = new Set<string>();

  for (const txn of history) {
    const desc = normalize(txn.description as string);
    if (vendorMatch(desc, excludeVendor)) continue;
    if (vendorsSeen.has(desc)) continue;

    const txnDate = new Date(txn.date as string);
    if (txnDate < windowStart || txnDate > windowEnd) continue;

    // Find this vendor's previous amount
    const prevTxns = history.filter(h => {
      const hDesc = normalize(h.description as string);
      const hDate = new Date(h.date as string);
      return vendorMatch(hDesc, desc) && hDate < txnDate && (h.amount as number) > 0;
    });

    if (prevTxns.length === 0) continue;

    const prevAmount = prevTxns[0].amount as number;
    const currAmount = txn.amount as number;
    if (prevAmount <= 0 || currAmount <= 0) continue;

    const pctChange = (currAmount - prevAmount) / prevAmount;
    if (Math.abs(pctChange - targetPctChange) <= tolerance) {
      vendorsSeen.add(desc);
    }
  }

  return vendorsSeen.size;
}
