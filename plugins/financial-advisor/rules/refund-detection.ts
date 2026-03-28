/**
 * Refund Detection Rule
 *
 * Identifies small credits that match the delta between old and new
 * recurring transaction amounts. Example: subscription goes from $9.99
 * to $10.49, then a $0.50 refund appears → likely a refund/price
 * adjustment, inherits the parent category.
 */

import type { InferenceRule, InferenceInput } from '@plures/pares-radix';

export const refundDetection: InferenceRule = {
  id: 'fa-refund-detection',
  name: 'Refund Detection',
  description: 'Identifies small credits from similar vendors that match price change deltas',
  appliesTo: ['transaction'],
  baseConfidence: 0.88,

  evaluate(input: InferenceInput) {
    const { record, history, confirmedInferences } = input;
    const amount = record.amount as number;
    const date = new Date(record.date as string);
    const description = normalize(record.description as string);

    // Only applies to credits (negative amounts or positive depending on convention)
    if (amount >= 0) return null; // Assuming credits are negative
    const creditAmount = Math.abs(amount);

    // Small credit threshold: $0.01 to $20.00
    if (creditAmount < 0.01 || creditAmount > 20.00) return null;

    // Find recent debits from similar vendor (within 30 days)
    const recentDebits = (history as Array<Record<string, unknown>>).filter(h => {
      const hAmount = h.amount as number;
      const hDate = new Date(h.date as string);
      const hDesc = normalize(h.description as string);
      const daysDiff = Math.abs(date.getTime() - hDate.getTime()) / (1000 * 60 * 60 * 24);

      return hAmount > 0 && daysDiff <= 30 && vendorOverlap(description, hDesc);
    });

    if (recentDebits.length === 0) return null;

    // Check if credit matches a price change delta
    for (const debit of recentDebits) {
      const debitAmount = debit.amount as number;

      // Look for another recent debit from same vendor with different amount
      const otherDebits = recentDebits.filter(
        d => d !== debit && Math.abs((d.amount as number) - debitAmount) > 0.001,
      );

      for (const other of otherDebits) {
        const delta = Math.abs(debitAmount - (other.amount as number));
        // Credit matches the delta (±$0.02 tolerance for rounding)
        if (Math.abs(creditAmount - delta) <= 0.02) {
          // Find category from confirmed inferences
          const categoryInference = confirmedInferences.find(
            inf => inf.field === 'category' && inf.sourceId === (debit.id as string),
          );

          const category = categoryInference?.value ?? 'Uncategorized';

          return {
            field: 'category',
            value: category,
            confidence: this.baseConfidence,
            reasoning: `Credit of $${creditAmount.toFixed(2)} from "${record.description}" matches price delta ($${debitAmount.toFixed(2)} → $${(other.amount as number).toFixed(2)} = $${delta.toFixed(2)} difference). Likely a refund or price adjustment. Category inherited from parent transaction.`,
          };
        }
      }
    }

    // Fallback: any small credit from a known vendor → inherit category
    const matchedDebit = recentDebits[0];
    const categoryInference = confirmedInferences.find(
      inf => inf.field === 'category' && inf.sourceId === (matchedDebit.id as string),
    );

    if (categoryInference) {
      return {
        field: 'category',
        value: categoryInference.value,
        confidence: 0.72, // Lower confidence for generic refund match
        reasoning: `Small credit of $${creditAmount.toFixed(2)} from similar vendor within 30 days of debit. Likely a refund. Category inherited with lower confidence.`,
      };
    }

    return null;
  },
};

function normalize(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function vendorOverlap(a: string, b: string): boolean {
  const wordsA = a.split(' ').filter(w => w.length > 2);
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2));
  const overlap = wordsA.filter(w => wordsB.has(w)).length;
  return overlap >= 1 && overlap / Math.min(wordsA.length, wordsB.size) >= 0.5;
}
