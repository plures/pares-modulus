/**
 * Transaction types and helpers for the fa-transactions PluresDB collection.
 *
 * Imported transactions are immutable — raw source data is stored as-is.
 * Inferences (category, tags, etc.) are written to a separate collection.
 */

export type TransactionType = 'debit' | 'credit' | 'transfer' | 'other';
export type ImportSource = 'csv' | 'ofx' | 'qfx';

export interface Transaction {
  /** Stable unique ID — FITID from OFX/QFX, or a UUID for CSV rows. */
  id: string;
  /** PluresDB fa-accounts document ID this transaction belongs to. */
  accountId: string;
  /** ISO 8601 date string (YYYY-MM-DD). */
  date: string;
  /** Raw description / memo from the source file. */
  description: string;
  /** Positive = credit (money in), negative = debit (money out). */
  amount: number;
  type: TransactionType;
  /** Which file format produced this record. */
  source: ImportSource;
  /**
   * OFX/QFX FITID used for exact-match duplicate detection.
   * Present only for OFX/QFX imports.
   */
  fitId?: string;
  /**
   * Hex-encoded SHA-256 prefix over "date|amount|description" used for
   * CSV duplicate detection (first 16 hex chars = 64-bit fingerprint).
   */
  hash?: string;
  /** ISO 8601 timestamp of when this record was imported. */
  importedAt: string;
}

export const FA_TRANSACTIONS_COLLECTION = 'fa-transactions';

export function generateTransactionId(): string {
  return `txn-${crypto.randomUUID()}`;
}

/**
 * Compute a short fingerprint for a CSV transaction row.
 * Uses the Web Crypto API (available in modern browsers and Deno/Bun/Node 20+).
 */
export async function hashCsvTransaction(
  date: string,
  amount: number,
  description: string,
): Promise<string> {
  const text = `${date}|${amount.toFixed(2)}|${description.trim().toLowerCase()}`;
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
