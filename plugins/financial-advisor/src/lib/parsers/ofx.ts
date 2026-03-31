/**
 * OFX / QFX transaction parser.
 *
 * Supports both:
 *  - OFX 1.x  — SGML-style (no closing tags, header block separated by blank line)
 *  - OFX 2.x  — Well-formed XML wrapped in <?OFX ... ?>
 *
 * QFX is Intuit's Quicken extension of OFX 1.x and is handled identically.
 *
 * Relevant STMTTRN fields extracted:
 *   TRNTYPE, DTPOSTED, TRNAMT, FITID, NAME, MEMO
 */

import { generateTransactionId, type Transaction } from '../transactions.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface OfxTransaction {
  fitId: string;
  date: string;        // YYYY-MM-DD
  amount: number;
  description: string; // NAME, falling back to MEMO
  rawType: string;     // TRNTYPE as-is (DEBIT, CREDIT, etc.)
}

export interface OfxParseResult {
  transactions: OfxTransaction[];
  accountId?: string;  // ACCTID if present
  currency?: string;   // CURDEF if present
}

// ── Date parsing ──────────────────────────────────────────────────────────────

/**
 * OFX date format: YYYYMMDDHHMMSS[.mmm][+/-HH:mm][:timezone]
 * We only need the calendar date portion.
 */
function parseOfxDate(raw: string): string | null {
  const s = raw.trim();
  // Minimum: YYYYMMDD (8 chars)
  if (s.length < 8) return null;
  const year = s.slice(0, 4);
  const month = s.slice(4, 6);
  const day = s.slice(6, 8);
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
  return `${year}-${month}-${day}`;
}

// ── OFX 1.x SGML parser ───────────────────────────────────────────────────────

/**
 * Extract the value of a leaf element like <FITID>12345 from SGML OFX.
 * OFX 1.x elements have no closing tags, so the value ends at the next < or newline.
 */
function sgmlValue(body: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>([^<\\n\\r]*)`, 'i');
  const m = body.match(pattern);
  return m ? m[1].trim() : null;
}

/**
 * Extract all <STMTTRN>...</STMTTRN> blocks from OFX 1.x SGML.
 * In SGML OFX 1.x, containers like STMTTRN have implied closing tags or
 * explicit </STMTTRN>. We split on <STMTTRN> and handle both.
 */
function parseSgmlTransactions(body: string): OfxTransaction[] {
  // Split on opening STMTTRN tags
  const chunks = body.split(/<STMTTRN>/i).slice(1);
  const transactions: OfxTransaction[] = [];

  for (const chunk of chunks) {
    // End at </STMTTRN> or the next <STMTTRN> (whichever comes first)
    const end = chunk.search(/<\/STMTTRN>|<STMTTRN>/i);
    const block = end === -1 ? chunk : chunk.slice(0, end);

    const fitId = sgmlValue(block, 'FITID');
    const rawDate = sgmlValue(block, 'DTPOSTED');
    const rawAmount = sgmlValue(block, 'TRNAMT');
    const name = sgmlValue(block, 'NAME');
    const memo = sgmlValue(block, 'MEMO');
    const trnType = sgmlValue(block, 'TRNTYPE') ?? 'OTHER';

    if (!fitId || !rawDate || !rawAmount) continue;

    const date = parseOfxDate(rawDate);
    const amount = parseFloat(rawAmount.replace(/[,$]/g, ''));
    if (!date || isNaN(amount)) continue;

    const description = (name || memo || '').trim();

    transactions.push({ fitId, date, amount, description, rawType: trnType.toUpperCase() });
  }

  return transactions;
}

/** Extract a named element value from OFX SGML body (for account/currency metadata). */
function extractSgmlMeta(body: string): Pick<OfxParseResult, 'accountId' | 'currency'> {
  return {
    accountId: sgmlValue(body, 'ACCTID') ?? undefined,
    currency: sgmlValue(body, 'CURDEF') ?? undefined,
  };
}

// ── OFX 2.x XML parser ────────────────────────────────────────────────────────

function xmlText(node: Element, tag: string): string | null {
  const el = node.querySelector(tag);
  return el ? (el.textContent?.trim() ?? null) : null;
}

function parseXmlTransactions(doc: Document): OfxTransaction[] {
  const stmtTrns = doc.querySelectorAll('STMTTRN');
  const transactions: OfxTransaction[] = [];

  stmtTrns.forEach(node => {
    const fitId = xmlText(node, 'FITID');
    const rawDate = xmlText(node, 'DTPOSTED');
    const rawAmount = xmlText(node, 'TRNAMT');
    const name = xmlText(node, 'NAME');
    const memo = xmlText(node, 'MEMO');
    const trnType = xmlText(node, 'TRNTYPE') ?? 'OTHER';

    if (!fitId || !rawDate || !rawAmount) return;

    const date = parseOfxDate(rawDate);
    const amount = parseFloat(rawAmount.replace(/[,$]/g, ''));
    if (!date || isNaN(amount)) return;

    const description = (name || memo || '').trim();
    transactions.push({ fitId, date, amount, description, rawType: trnType.toUpperCase() });
  });

  return transactions;
}

function extractXmlMeta(doc: Document): Pick<OfxParseResult, 'accountId' | 'currency'> {
  const acctId = doc.querySelector('ACCTID')?.textContent?.trim();
  const currency = doc.querySelector('CURDEF')?.textContent?.trim();
  return { accountId: acctId, currency };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Parse an OFX or QFX file string.
 *
 * Automatically detects whether it's OFX 1.x SGML or OFX 2.x XML.
 */
export function parseOfx(raw: string): OfxParseResult {
  // Normalise line endings and BOM
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Detect OFX 2.x XML: starts with <?xml or <?OFX
  const isXml = /^\s*<\?(?:xml|OFX)/i.test(text);

  if (isXml) {
    // Use browser DOMParser (available in all modern browsers and jsdom)
    // Strip the <?OFX?> PI if present since browsers may reject it
    const xmlStr = text.replace(/<\?OFX[^>]*\?>/i, '');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');
    return {
      transactions: parseXmlTransactions(doc),
      ...extractXmlMeta(doc),
    };
  }

  // OFX 1.x SGML — strip the header block (everything before the first blank line before <OFX>)
  const ofxStart = text.indexOf('<OFX>');
  const body = ofxStart !== -1 ? text.slice(ofxStart) : text;

  return {
    transactions: parseSgmlTransactions(body),
    ...extractSgmlMeta(body),
  };
}

// ── Convert to Transaction objects ───────────────────────────────────────────

/**
 * Convert parsed OFX transactions to draft Transaction objects
 * (without accountId or importedAt — caller fills those in).
 */
export function ofxTransactionsToTransactions(
  rows: OfxTransaction[],
  source: 'ofx' | 'qfx',
): Omit<Transaction, 'accountId' | 'importedAt'>[] {
  return rows.map(row => ({
    id: generateTransactionId(),
    date: row.date,
    description: row.description,
    amount: row.amount,
    type: mapTrnType(row.rawType),
    source,
    fitId: row.fitId,
  }));
}

function mapTrnType(raw: string): Transaction['type'] {
  switch (raw.toUpperCase()) {
    case 'DEBIT':
    case 'CHECK':
    case 'FEE':
    case 'SRVCHG':
      return 'debit';
    case 'CREDIT':
    case 'DEP':
    case 'INT':
    case 'DIV':
      return 'credit';
    case 'XFER':
      return 'transfer';
    default:
      return 'other';
  }
}
