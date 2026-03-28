/**
 * Vendor Clustering Rule
 *
 * Groups variant vendor names into canonical clusters:
 * "AMZN", "Amazon.com", "AMAZON MARKETPLACE" → same vendor → same category.
 */

import type { InferenceRule, InferenceInput } from '@plures/pares-radix';

/** Well-known vendor aliases. Extensible via shared federated rules. */
const VENDOR_ALIASES: Record<string, string[]> = {
  'amazon': ['amzn', 'amazon.com', 'amazon marketplace', 'amzn mktp', 'amazon prime'],
  'walmart': ['wal-mart', 'wm supercenter', 'walmart.com'],
  'target': ['target.com', 'target store'],
  'starbucks': ['starbucks coffee', 'starbucks store'],
  'uber': ['uber eats', 'uber trip', 'uber* eats', 'uber* trip'],
  'lyft': ['lyft ride', 'lyft* ride'],
  'netflix': ['nflx', 'netflix.com'],
  'spotify': ['spotify usa', 'spotify ab'],
  'apple': ['apple.com', 'apple.com/bill', 'itunes', 'apple store'],
  'google': ['google *', 'google cloud', 'google storage', 'google one'],
  'microsoft': ['msft', 'microsoft*', 'microsoft 365', 'xbox'],
  'venmo': ['venmo *', 'venmo payment'],
  'paypal': ['paypal *', 'paypal inst'],
  'costco': ['costco whse', 'costco.com', 'costco gas'],
};

export const vendorClustering: InferenceRule = {
  id: 'fa-vendor-clustering',
  name: 'Vendor Clustering',
  description: 'Groups variant vendor names into canonical clusters for consistent categorization',
  appliesTo: ['transaction'],
  baseConfidence: 0.92,

  evaluate(input: InferenceInput) {
    const { record, confirmedInferences } = input;
    const description = normalize(record.description as string);

    // Check against known aliases
    const canonical = findCanonical(description);
    if (!canonical) return null;

    // Find confirmed category for this canonical vendor
    const match = confirmedInferences.find(inf => {
      if (inf.field !== 'category') return false;
      // Check if any of canonical's aliases match
      const aliases = VENDOR_ALIASES[canonical] ?? [];
      return aliases.some(alias => normalize(inf.sourceId).includes(alias))
        || normalize(inf.sourceId).includes(canonical);
    });

    if (!match) return null;

    return {
      field: 'category',
      value: match.value,
      confidence: this.baseConfidence,
      reasoning: `Vendor "${record.description}" matches canonical vendor "${canonical}" (known alias). Category inherited from confirmed match.`,
    };
  },
};

function normalize(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function findCanonical(normalized: string): string | null {
  for (const [canonical, aliases] of Object.entries(VENDOR_ALIASES)) {
    if (normalized.includes(canonical)) return canonical;
    for (const alias of aliases) {
      if (normalized.includes(alias.replace(/[^a-z0-9\s]/g, '').trim())) return canonical;
    }
  }
  return null;
}
