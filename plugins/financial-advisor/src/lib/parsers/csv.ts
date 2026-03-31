/**
 * CSV parser for bank transaction exports.
 *
 * Auto-detects column layouts for Chase, Bank of America, and Wells Fargo.
 * Falls back to a generic heuristic for any other CSV with recognisable
 * date / amount / description columns.
 */

import { generateTransactionId, hashCsvTransaction, type Transaction } from '../transactions.js';

// ── Public types ─────────────────────────────────────────────────────────────

export type BankFormat = 'chase' | 'bofa' | 'wells-fargo' | 'generic';

export interface ParsedCsvRow {
  date: string;
  description: string;
  amount: number;
}

export interface CsvParseResult {
  format: BankFormat;
  rows: ParsedCsvRow[];
  skipped: number;
}

// ── Column-index maps per bank ────────────────────────────────────────────────

/** Chase: Transaction Date, Post Date, Description, Category, Type, Amount, Memo */
const CHASE_HEADERS = ['transaction date', 'post date', 'description', 'category', 'type', 'amount'];

/** BofA minimal required headers: Date, Description, Amount. */
const BOFA_MIN_HEADERS = ['date', 'description', 'amount'];

/**
 * Wells Fargo: "Date","Amount","*","*","Description"
 * The wildcard columns vary; only positions 0 (Date), 1 (Amount), 4 (Description) matter.
 */
const WELLS_FARGO_PATTERN = /^"?\d{1,2}\/\d{1,2}\/\d{4}"?,/;

// ── Header detection ──────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
}

function detectFormat(headerLine: string): BankFormat {
  const cols = splitCsvLine(headerLine).map(normalise);

  if (CHASE_HEADERS.every(h => cols.includes(h))) return 'chase';

  // BofA header can appear on various lines; check the minimal set
  if (BOFA_MIN_HEADERS.every(h => cols.includes(h))) {
    // Wells Fargo uses numeric/empty headers — BofA explicitly labels them
    if (!cols.includes('running bal') && cols.join(',').includes('description')) {
      return 'bofa';
    }
  }

  // Wells Fargo: first data line matches date pattern (no named headers)
  return 'generic';
}

// ── CSV line splitter (handles quoted fields with commas) ─────────────────────

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── Date normalisation ────────────────────────────────────────────────────────

/**
 * Converts M/D/YYYY, MM/DD/YYYY, or YYYY-MM-DD to YYYY-MM-DD.
 * Returns null if the value cannot be parsed.
 */
function normaliseDate(raw: string): string | null {
  const s = raw.trim().replace(/^["']|["']$/g, '');

  // Already ISO: 2024-03-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

// ── Amount parsing ────────────────────────────────────────────────────────────

function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/[,$"']/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── Per-format row parsers ────────────────────────────────────────────────────

function parseChaseRow(cols: string[]): ParsedCsvRow | null {
  // Columns: Transaction Date(0), Post Date(1), Description(2), Category(3), Type(4), Amount(5), Memo(6?)
  const date = normaliseDate(cols[0] ?? '');
  const description = (cols[2] ?? '').trim();
  const amount = parseAmount(cols[5] ?? '');
  if (!date || !description || amount === null) return null;
  return { date, description, amount };
}

function parseBofaRow(cols: string[], dateIdx: number, descIdx: number, amtIdx: number): ParsedCsvRow | null {
  const date = normaliseDate(cols[dateIdx] ?? '');
  const description = (cols[descIdx] ?? '').trim();
  const amount = parseAmount(cols[amtIdx] ?? '');
  if (!date || !description || amount === null) return null;
  return { date, description, amount };
}

function parseWellsFargoRow(cols: string[]): ParsedCsvRow | null {
  // Date(0), Amount(1), *(2), *(3), Description(4)
  const date = normaliseDate(cols[0] ?? '');
  const description = (cols[4] ?? '').trim();
  const amount = parseAmount(cols[1] ?? '');
  if (!date || !description || amount === null) return null;
  return { date, description, amount };
}

// ── Generic fallback ──────────────────────────────────────────────────────────

function findColumnIndices(
  headers: string[],
): { dateIdx: number; descIdx: number; amtIdx: number } | null {
  const norm = headers.map(normalise);

  const dateIdx = norm.findIndex(h => h.includes('date'));
  const descIdx = norm.findIndex(
    h => h.includes('description') || h.includes('memo') || h.includes('name'),
  );
  // Prefer a true "amount" column when present. Only fall back to a single
  // "debit" or "credit" column. If both debit and credit columns exist, we
  // cannot safely infer a single amount column, so we decline generic parsing.
  const amountIdx = norm.findIndex(h => h === 'amount');
  const debitIdx = norm.findIndex(h => h === 'debit');
  const creditIdx = norm.findIndex(h => h === 'credit');

  let amtIdx = -1;
  if (amountIdx !== -1) {
    amtIdx = amountIdx;
  } else {
    const hasDebit = debitIdx !== -1;
    const hasCredit = creditIdx !== -1;

    if (hasDebit && !hasCredit) {
      amtIdx = debitIdx;
    } else if (!hasDebit && hasCredit) {
      amtIdx = creditIdx;
    } else {
      // Either both debit and credit exist, or neither does – in both cases
      // we cannot identify a single reliable amount column.
      amtIdx = -1;
    }
  }
  if (dateIdx === -1 || descIdx === -1 || amtIdx === -1) return null;
  return { dateIdx, descIdx, amtIdx };
}

// ── Main parse function ───────────────────────────────────────────────────────

/**
 * Parse a raw CSV string into `ParsedCsvRow[]`.
 * Returns the detected bank format and any rows that could not be parsed (skipped count).
 */
export function parseCsv(raw: string): CsvParseResult {
  // Normalise line endings and drop BOM
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter(l => l.trim() !== '');

  if (lines.length === 0) {
    return { format: 'generic', rows: [], skipped: 0 };
  }

  // ── Detect Wells Fargo (no header row — first line is a data row) ──────────
  if (WELLS_FARGO_PATTERN.test(lines[0])) {
    const rows: ParsedCsvRow[] = [];
    let skipped = 0;
    for (const line of lines) {
      const cols = splitCsvLine(line);
      const row = parseWellsFargoRow(cols);
      if (row) rows.push(row);
      else skipped++;
    }
    return { format: 'wells-fargo', rows, skipped };
  }

  // ── Header-based formats ──────────────────────────────────────────────────
  const headerLine = lines[0];
  const format = detectFormat(headerLine);
  const headers = splitCsvLine(headerLine).map(normalise);
  const dataLines = lines.slice(1);

  const rows: ParsedCsvRow[] = [];
  let skipped = 0;

  if (format === 'chase') {
    for (const line of dataLines) {
      const cols = splitCsvLine(line);
      const row = parseChaseRow(cols);
      if (row) rows.push(row);
      else skipped++;
    }
    return { format, rows, skipped };
  }

  // BofA or generic — find column indices from headers
  const indices = findColumnIndices(headers);
  if (!indices) {
    // Cannot determine columns
    return { format, rows: [], skipped: dataLines.length };
  }

  const { dateIdx, descIdx, amtIdx } = indices;
  for (const line of dataLines) {
    const cols = splitCsvLine(line);
    const row = parseBofaRow(cols, dateIdx, descIdx, amtIdx);
    if (row) rows.push(row);
    else skipped++;
  }
  return { format, rows, skipped };
}

// ── Convert to Transaction objects ───────────────────────────────────────────

/**
 * Convert parsed CSV rows to draft Transaction objects (without accountId or importedAt).
 * Hashes are computed asynchronously for duplicate detection.
 */
export async function csvRowsToTransactions(
  rows: ParsedCsvRow[],
  source: 'csv',
): Promise<Omit<Transaction, 'accountId' | 'importedAt'>[]> {
  return Promise.all(
    rows.map(async row => {
      const hash = await hashCsvTransaction(row.date, row.amount, row.description);
      return {
        id: generateTransactionId(),
        date: row.date,
        description: row.description,
        amount: row.amount,
        type: (row.amount < 0 ? 'debit' : 'credit') as Transaction['type'],
        source,
        hash,
      };
    }),
  );
}
