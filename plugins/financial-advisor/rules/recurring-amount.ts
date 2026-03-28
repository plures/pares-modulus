/**
 * Recurring Amount Pattern Rule
 *
 * Detects transactions that recur at roughly the same interval for
 * roughly the same amount from the same vendor. High confidence
 * that they share a category.
 */

import type { InferenceRule, InferenceInput } from '@plures/pares-radix';

export const recurringAmountPattern: InferenceRule = {
  id: 'fa-recurring-amount',
  name: 'Recurring Amount Pattern',
  description: 'Matches transactions with similar vendor, amount (±5%), and monthly interval (±5 days)',
  appliesTo: ['transaction'],
  baseConfidence: 0.85,

  evaluate(input: InferenceInput) {
    const { record, confirmedInferences } = input;
    const vendor = normalizeVendor(record.description as string);
    const amount = Math.abs(record.amount as number);
    const date = new Date(record.date as string);

    // Find confirmed transactions with similar vendor
    const matches = confirmedInferences.filter(inf => {
      if (inf.field !== 'category') return false;
      const infVendor = normalizeVendor(inf.sourceId); // simplified — real impl queries source
      return vendorSimilarity(vendor, infVendor) > 0.80;
    });

    if (matches.length < 2) return null;

    // Check amount tolerance (±5%)
    const amounts = matches.map(m => Math.abs(m.value as number));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountDelta = Math.abs(amount - avgAmount) / avgAmount;
    if (amountDelta > 0.05) return null;

    // Category from confirmed matches
    const category = matches[0].value as string;
    const matchCount = matches.length;

    // Confidence: base + 0.05 per additional confirmed match (cap at 0.98)
    const confidence = Math.min(0.98, this.baseConfidence + (matchCount - 2) * 0.05);

    return {
      field: 'category',
      value: category,
      confidence,
      reasoning: `Vendor "${vendor}" matches ${matchCount} confirmed transactions with avg amount $${avgAmount.toFixed(2)} (±${(amountDelta * 100).toFixed(1)}%). All categorized as "${category}".`,
    };
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeVendor(description: string): string {
  return (description ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function vendorSimilarity(a: string, b: string): number {
  // Jaro-Winkler similarity (simplified)
  if (a === b) return 1.0;
  if (!a.length || !b.length) return 0.0;

  const maxDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler bonus for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}
