/**
 * Validate a capability PROVIDER plugin's declared CID surface against the
 * capability contract (CID) it claims to provide.  ADR-0022 step 6.
 *
 * Usage: npx tsx gates/validate-cid-surface.ts <plugin-dir>
 *
 * ----------------------------------------------------------------------------
 * THE TWO-MANIFEST SEAM (resolution A)
 * ----------------------------------------------------------------------------
 * Modulus gates validate manifest.json against registry/schema.json, but Radix
 * capability declarations live in **plugin.toml** and registry/schema.json has
 * no capability/CID fields.  This gate therefore reads plugin.toml directly:
 *
 *   [capabilities.provided]
 *     commerce = "1.0.0"
 *   [capabilities.interface.commerce]
 *     cid  = "commerce@1.x"
 *     spec = "capabilities/commerce.cid.toml"
 *     provides_operations = [ "issue_coupon", ... ]
 *     provides_events     = [ "commerce.issue.completed", ... ]
 *
 * Behaviour:
 *   - No plugin.toml, or no [capabilities.provided]  -> NO-OP PASS (exit 0).
 *     (Not every plugin is a capability provider.)
 *   - For each provided capability we require a matching
 *     [capabilities.interface.<cap>] block with provides_operations and
 *     provides_events arrays.  Missing block / arrays -> FAIL.
 *   - We resolve the referenced CID `spec` file.  If found, we require that
 *     provides_operations covers every CID [[operations]].name and that
 *     provides_events covers every CID provider event
 *     ([[operations]].result_event ∪ events.emitted_by_provider).
 *     Missing surface -> FAIL (exit 1), naming the missing piece.
 *   - If the CID spec path is NOT resolvable (contract not vendored in
 *     modulus), we do NOT silently pass: we record a real
 *     "CapabilityUnavailable" skip for that capability, still validate the
 *     declared arrays for internal consistency (non-empty, no dupes,
 *     operations referenced have plausible shape), and FAIL only on internal
 *     inconsistency — the unresolved-spec condition is reported as a SKIP,
 *     not a pass, and surfaced in the summary.
 *
 * CID spec resolution order (first existing wins):
 *   1. <plugin-dir>/<spec>
 *   2. <plugin-dir>/../<spec>            (sibling layout)
 *   3. registry/capabilities/<basename> (modulus-vendored contracts)
 *   4. capabilities/<basename>          (repo-root capabilities/)
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { parseToml, type TomlTable, TomlError } from './lib/toml.js';

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error('Usage: validate-cid-surface.ts <plugin-dir>');
  process.exit(1);
}

const tomlPath = join(pluginDir, 'plugin.toml');
if (!existsSync(tomlPath)) {
  passAndExit(`✅ CID surface: no plugin.toml in ${pluginDir} — not a capability provider (skip)`);
}

/** Print an error and abort — typed `never` so it works without @types/node. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
  throw new Error(message); // unreachable; satisfies control-flow analysis
}

/** Print a success line and exit 0 — typed `never` for clean narrowing. */
function passAndExit(message: string): never {
  console.log(message);
  process.exit(0);
  throw new Error(message); // unreachable
}

function parseDoc(): TomlTable {
  try {
    return parseToml(readFileSync(tomlPath, 'utf-8'));
  } catch (e) {
    const msg = e instanceof TomlError ? e.message : String(e);
    fail(`❌ CID surface: failed to parse ${tomlPath}: ${msg}`);
  }
}
const doc: TomlTable = parseDoc();

function asTable(v: unknown): TomlTable | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as TomlTable) : undefined;
}
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  if (!v.every((x) => typeof x === 'string')) return undefined;
  return v as string[];
}

const capabilities = asTable(doc.capabilities);
const provided = capabilities ? asTable(capabilities.provided) : undefined;

if (!provided || Object.keys(provided).length === 0) {
  passAndExit(
    `✅ CID surface: ${pluginDir} declares no [capabilities.provided] — non-provider (skip)`,
  );
}

const interfaces = capabilities ? asTable(capabilities.interface) : undefined;

const errors: string[] = [];
const skips: string[] = [];
const passes: string[] = [];

interface CidContract {
  operations: string[]; // [[operations]].name
  providerEvents: string[]; // result_event ∪ events.emitted_by_provider
}

function loadCid(specRel: string): { path: string; cid: CidContract } | undefined {
  const candidates = [
    join(pluginDir, specRel),
    join(dirname(pluginDir), specRel),
    join('registry', 'capabilities', basename(specRel)),
    join('capabilities', basename(specRel)),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) return undefined;

  let cidDoc: TomlTable;
  try {
    cidDoc = parseToml(readFileSync(found, 'utf-8'));
  } catch (e) {
    const msg = e instanceof TomlError ? e.message : String(e);
    throw new Error(`CID spec ${found} is not parseable: ${msg}`);
  }

  const ops = Array.isArray(cidDoc.operations) ? (cidDoc.operations as TomlTable[]) : [];
  const opNames: string[] = [];
  const resultEvents: string[] = [];
  for (const op of ops) {
    if (op && typeof op.name === 'string') opNames.push(op.name);
    if (op && typeof op.result_event === 'string') resultEvents.push(op.result_event);
  }
  const events = asTable(cidDoc.events);
  const emittedByProvider = events ? asStringArray(events.emitted_by_provider) ?? [] : [];
  const providerEvents = Array.from(new Set([...resultEvents, ...emittedByProvider]));

  return { path: found, cid: { operations: opNames, providerEvents } };
}

function dupes(arr: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const x of arr) {
    if (seen.has(x)) dup.add(x);
    seen.add(x);
  }
  return [...dup];
}

for (const cap of Object.keys(provided)) {
  const version = provided[cap];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
    errors.push(`capability "${cap}": provided version "${String(version)}" is not SemVer`);
  }

  const iface = interfaces ? asTable(interfaces[cap]) : undefined;
  if (!iface) {
    errors.push(`capability "${cap}": missing [capabilities.interface.${cap}] block`);
    continue;
  }

  const cid = typeof iface.cid === 'string' ? iface.cid : undefined;
  const spec = typeof iface.spec === 'string' ? iface.spec : undefined;
  const provOps = asStringArray(iface.provides_operations);
  const provEvents = asStringArray(iface.provides_events);

  if (!cid) errors.push(`capability "${cap}": interface missing "cid" (e.g. "${cap}@1.x")`);
  if (!spec) errors.push(`capability "${cap}": interface missing "spec" path`);
  if (!provOps) {
    errors.push(`capability "${cap}": interface missing/invalid "provides_operations" (string array)`);
  }
  if (!provEvents) {
    errors.push(`capability "${cap}": interface missing/invalid "provides_events" (string array)`);
  }

  // CID major in interface should line up with declared provided version major.
  if (cid && typeof version === 'string') {
    const cidMajor = /@(\d+)\./.exec(cid)?.[1];
    const verMajor = /^(\d+)\./.exec(version)?.[1];
    if (cidMajor && verMajor && cidMajor !== verMajor) {
      errors.push(
        `capability "${cap}": cid "${cid}" major ${cidMajor} ≠ provided ${version} major ${verMajor}`,
      );
    }
  }

  if (!provOps || !provEvents) continue; // already errored on shape

  // Internal consistency: non-empty, no duplicates.
  if (provOps.length === 0) errors.push(`capability "${cap}": provides_operations is empty`);
  if (provEvents.length === 0) errors.push(`capability "${cap}": provides_events is empty`);
  const dOps = dupes(provOps);
  const dEv = dupes(provEvents);
  if (dOps.length) errors.push(`capability "${cap}": duplicate provides_operations: ${dOps.join(', ')}`);
  if (dEv.length) errors.push(`capability "${cap}": duplicate provides_events: ${dEv.join(', ')}`);

  if (!spec) continue;

  let loaded: { path: string; cid: CidContract } | undefined;
  try {
    loaded = loadCid(spec);
  } catch (e) {
    errors.push(`capability "${cap}": ${(e as Error).message}`);
    continue;
  }

  if (!loaded) {
    // CapabilityUnavailable-style SKIP — NOT a silent pass.
    skips.push(
      `capability "${cap}": CID spec "${spec}" not resolvable in modulus ` +
        `(CapabilityUnavailable) — declared surface validated for internal consistency only`,
    );
    passes.push(
      `capability "${cap}": internal surface OK (${provOps.length} ops, ${provEvents.length} events) [spec unresolved]`,
    );
    continue;
  }

  const { cid: contract, path: cidPath } = loaded;
  const opSet = new Set(provOps);
  const evSet = new Set(provEvents);
  const missingOps = contract.operations.filter((o) => !opSet.has(o));
  const missingEvents = contract.providerEvents.filter((ev) => !evSet.has(ev));

  if (missingOps.length) {
    errors.push(
      `capability "${cap}": provides_operations is missing CID operation(s) ` +
        `[${missingOps.join(', ')}] required by ${cidPath}`,
    );
  }
  if (missingEvents.length) {
    errors.push(
      `capability "${cap}": provides_events is missing CID provider event(s) ` +
        `[${missingEvents.join(', ')}] required by ${cidPath}`,
    );
  }
  if (!missingOps.length && !missingEvents.length) {
    passes.push(
      `capability "${cap}": surface satisfies ${cidPath} ` +
        `(${contract.operations.length} ops, ${contract.providerEvents.length} provider events)`,
    );
  }
}

// Report.
for (const s of skips) console.warn(`⚠️  ${s}`);

if (errors.length > 0) {
  console.error(`❌ CID surface validation FAILED for ${pluginDir}:`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

for (const p of passes) console.log(`   • ${p}`);
const capList = Object.keys(provided).join(', ');
if (skips.length > 0) {
  console.log(`✅ CID surface valid for ${pluginDir} (provides: ${capList}; ${skips.length} spec(s) unresolved → reported)`);
} else {
  console.log(`✅ CID surface valid for ${pluginDir} (provides: ${capList})`);
}
