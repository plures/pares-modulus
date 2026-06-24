/**
 * Minimal, dependency-free TOML reader for modulus capability gates.
 *
 * WHY THIS EXISTS (and is NOT a stub): pares-modulus has a `workspace:*`
 * devDependency that breaks `npm install` in this environment, and the repo
 * ships no committed node_modules. Adding a heavyweight TOML dependency would
 * make the CID-surface gate un-runnable in the same `npx tsx gates/<x>.ts`
 * fashion as every other gate. So we vendor a small, real parser that covers
 * exactly the TOML subset used by Radix capability declarations and CID
 * contract files:
 *
 *   - top-level   key = value
 *   - tables       [a]   and dotted   [a.b.c]
 *   - array-of-tables [[a]] / [[a.b]]
 *   - string values        key = "text"   (basic + literal strings)
 *   - integer / float / bool values
 *   - string/scalar arrays  key = ["a", "b"]  (single- or multi-line)
 *   - `#` line comments and trailing comments outside strings
 *
 * It deliberately does NOT implement the full TOML spec (no inline tables,
 * dates, multi-line basic strings with escapes beyond the common ones, etc.).
 * Unsupported constructs raise a TomlError so the gate fails loudly rather
 * than silently mis-reading a contract.
 */

export class TomlError extends Error {
  constructor(message: string, public line: number) {
    super(`TOML parse error (line ${line}): ${message}`);
    this.name = 'TomlError';
  }
}

type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

/** Strip a trailing `#` comment that is not inside a string. */
function stripComment(line: string): string {
  let inStr = false;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\' && quote === '"') {
        i++; // skip escaped char (basic strings only)
        continue;
      }
      if (ch === quote) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Split a dotted key path, respecting quoted segments. */
function splitDottedKey(raw: string, lineNo: number): string[] {
  const parts: string[] = [];
  let cur = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (ch === quote) inStr = false;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === '.') {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0 || parts.length === 0) parts.push(cur.trim());
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0) throw new TomlError(`empty key`, lineNo);
  return cleaned;
}

function parseScalar(raw: string, lineNo: number): TomlValue {
  const v = raw.trim();
  if (v.length === 0) throw new TomlError('missing value', lineNo);
  // Basic string
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    const inner = v.slice(1, -1);
    return inner
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
  // Literal string
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^[+-]?\d+$/.test(v)) return parseInt(v, 10);
  if (/^[+-]?(\d+\.\d+|\d+\.\d+[eE][+-]?\d+|\d+[eE][+-]?\d+)$/.test(v)) {
    return parseFloat(v);
  }
  throw new TomlError(`unsupported scalar value: ${v}`, lineNo);
}

/** Parse the contents of an array literal body (without the surrounding []). */
function parseArrayBody(body: string, lineNo: number): TomlValue[] {
  const items: TomlValue[] = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  let quote = '';
  const pushItem = () => {
    const t = cur.trim();
    if (t.length > 0) items.push(parseScalar(t, lineNo));
    cur = '';
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === '\\' && quote === '"') {
        if (i + 1 < body.length) cur += body[++i];
        continue;
      }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      cur += ch;
    } else if (ch === '[') {
      depth++;
      cur += ch;
    } else if (ch === ']') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      pushItem();
    } else {
      cur += ch;
    }
  }
  pushItem();
  return items;
}

function setPath(root: TomlTable, path: string[], value: TomlValue, lineNo: number): void {
  let node: TomlTable = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    let next = node[key];
    if (next === undefined) {
      next = {};
      node[key] = next;
    } else if (Array.isArray(next)) {
      // Dotted key into the last element of an array-of-tables.
      const last = next[next.length - 1];
      if (typeof last !== 'object' || Array.isArray(last)) {
        throw new TomlError(`cannot descend into array key "${key}"`, lineNo);
      }
      next = last;
    } else if (typeof next !== 'object') {
      throw new TomlError(`key "${key}" is not a table`, lineNo);
    }
    node = next as TomlTable;
  }
  const leaf = path[path.length - 1];
  if (leaf in node) throw new TomlError(`duplicate key "${path.join('.')}"`, lineNo);
  node[leaf] = value;
}

/** Resolve (creating as needed) a table at the given dotted path. */
function resolveTable(root: TomlTable, path: string[], lineNo: number): TomlTable {
  let node: TomlTable = root;
  for (const key of path) {
    let next = node[key];
    if (next === undefined) {
      next = {};
      node[key] = next;
    } else if (Array.isArray(next)) {
      const last = next[next.length - 1];
      if (typeof last !== 'object' || Array.isArray(last)) {
        throw new TomlError(`path conflict at "${key}"`, lineNo);
      }
      next = last;
    } else if (typeof next !== 'object') {
      throw new TomlError(`path conflict: "${key}" is a value`, lineNo);
    }
    node = next as TomlTable;
  }
  return node;
}

/** Append a new table to an array-of-tables at the given dotted path; return it. */
function appendArrayTable(root: TomlTable, path: string[], lineNo: number): TomlTable {
  const parent = resolveTable(root, path.slice(0, -1), lineNo);
  const key = path[path.length - 1];
  let arr = parent[key];
  if (arr === undefined) {
    arr = [];
    parent[key] = arr;
  }
  if (!Array.isArray(arr)) {
    throw new TomlError(`"${path.join('.')}" already defined as non-array`, lineNo);
  }
  const tbl: TomlTable = {};
  arr.push(tbl);
  return tbl;
}

export function parseToml(input: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root; // active table context for bare key = value
  const rawLines = input.split(/\r?\n/);

  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNo = idx + 1;
    let line = stripComment(rawLines[idx]).trim();
    if (line.length === 0) continue;

    // Array-of-tables header  [[a.b]]
    if (line.startsWith('[[') && line.endsWith(']]')) {
      const inner = line.slice(2, -2).trim();
      const path = splitDottedKey(inner, lineNo);
      current = appendArrayTable(root, path, lineNo);
      continue;
    }
    // Table header  [a.b]
    if (line.startsWith('[') && line.endsWith(']')) {
      const inner = line.slice(1, -1).trim();
      const path = splitDottedKey(inner, lineNo);
      current = resolveTable(root, path, lineNo);
      continue;
    }

    // key = value
    const eq = indexOfAssignment(line, lineNo);
    const rawKey = line.slice(0, eq).trim();
    let rawVal = line.slice(eq + 1).trim();
    const keyPath = splitDottedKey(rawKey, lineNo);

    if (rawVal.startsWith('[')) {
      // Possibly multi-line array — accumulate until brackets balance.
      let buf = rawVal;
      while (!arrayBracketsBalanced(buf)) {
        idx++;
        if (idx >= rawLines.length) throw new TomlError('unterminated array', lineNo);
        buf += '\n' + stripComment(rawLines[idx]);
      }
      const body = buf.slice(buf.indexOf('[') + 1, buf.lastIndexOf(']'));
      const arr = parseArrayBody(body, lineNo);
      setPath(current, keyPath, arr, lineNo);
    } else {
      const val = parseScalar(rawVal, lineNo);
      setPath(current, keyPath, val, lineNo);
    }
  }

  return root;
}

function indexOfAssignment(line: string, lineNo: number): number {
  let inStr = false;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === quote) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === '=') {
      return i;
    }
  }
  throw new TomlError(`expected key = value, got: ${line}`, lineNo);
}

function arrayBracketsBalanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\' && quote === '"') {
        i++;
        continue;
      }
      if (ch === quote) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
    }
  }
  return depth <= 0;
}
