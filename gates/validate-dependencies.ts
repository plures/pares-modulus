/**
 * Validate a plugin's CAPABILITY-AWARE dependencies (ADR-0022 / ADR-0024).
 * Usage: npx tsx gates/validate-dependencies.ts plugins/<name>
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS GATE ENFORCES (the directive-#2 mechanism)
 * ----------------------------------------------------------------------------
 * Modulus manifests carry TWO kinds of dependency:
 *
 *   "dependencies": ["other-plugin-id", ...]      // hard, ID-based
 *                                                 // (VS Code extensionDependencies)
 *   "capabilities": {
 *     "requires": { "secrets": "^1", ... },       // cap-name -> semver range
 *     "provides": { "secrets": "1.0.0" }          // cap-name -> semver version
 *   }
 *
 * For the plugin under test this gate:
 *   1. For every capability in `capabilities.requires`, scans ALL plugin
 *      manifests in plugins/* for a provider whose `capabilities.provides`
 *      satisfies name + semver. UNSATISFIED required capability -> FAIL.
 *      (C-constraint "never ship warnings": a missing required capability is an
 *      ERROR, not a warning.)
 *   2. Detects cycles in the ID `dependencies` graph across plugins/* and FAILs
 *      on any cycle reachable from the plugin under test.
 *   3. Cross-checks the plugin's own `capabilities.provides` against the
 *      provided-surface declared in its linked radix CID (plugin.toml
 *      [capabilities.provided]) when a plugin.toml is present. Mismatch -> FAIL.
 *
 * A plugin that declares no `capabilities.requires` and no `capabilities.provides`
 * is a NO-OP PASS (not every plugin is a capability consumer/provider).
 *
 * Semver handling is intentionally tiny (caret `^`, exact, `>=`/`>`/`<=`/`<`,
 * and `*`/`x` wildcards) — no heavy dependency is added; the range logic lives
 * inline below (see `satisfies`).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseToml, type TomlTable, TomlError } from './lib/toml.js';

const PLUGINS_DIR = 'plugins';

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error('Usage: validate-dependencies.ts <plugin-dir>');
  process.exit(1);
}

const manifestPath = join(pluginDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`❌ No manifest.json found in ${pluginDir}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Tiny semver / range helpers (no external dep).
// ---------------------------------------------------------------------------

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a bare "X.Y.Z" (trailing pre-release/build ignored). undefined on garbage. */
function parseVersion(v: string): SemVer | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** -1 | 0 | 1 comparing a vs b. */
function cmp(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Does concrete version `version` satisfy `range`?
 * Supported forms (intentionally small, deterministic):
 *   - "*"  / "x"                      -> any valid version
 *   - "1" / "1.x" / "1.2" / "1.2.x"   -> prefix match
 *   - "1.2.3"                         -> exact
 *   - "^1.2.3"                        -> >=1.2.3 and same major (or for 0.x, same minor)
 *   - ">=1.2.3" ">1.2.3" "<=1.2.3" "<1.2.3"
 *   - "=1.2.3"                        -> exact
 * Returns false on anything it cannot parse (fail-closed; "never ship warnings").
 */
function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();

  if (r === '*' || r === 'x' || r === 'X' || r === '') return true;

  // Comparator forms.
  const cmpMatch = /^(>=|<=|>|<|=)\s*(\d+)\.(\d+)\.(\d+)/.exec(r);
  if (cmpMatch) {
    const [, op, ma, mi, pa] = cmpMatch;
    const target: SemVer = { major: Number(ma), minor: Number(mi), patch: Number(pa) };
    const c = cmp(v, target);
    switch (op) {
      case '>=':
        return c >= 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      case '<':
        return c < 0;
      case '=':
        return c === 0;
    }
  }

  // Caret: compatible-with. ^1.2.3 -> >=1.2.3 <2.0.0 ; ^0.2.3 -> >=0.2.3 <0.3.0 ;
  // ^0.0.3 -> >=0.0.3 <0.0.4. Bare "^1" / "^1.2" fill missing parts with 0.
  if (r.startsWith('^')) {
    const baseStr = r.slice(1).trim();
    const parts = baseStr.split('.').map((p) => Number(p));
    const base: SemVer = {
      major: Number.isFinite(parts[0]) ? parts[0] : 0,
      minor: Number.isFinite(parts[1]) ? parts[1] : 0,
      patch: Number.isFinite(parts[2]) ? parts[2] : 0,
    };
    if (cmp(v, base) < 0) return false;
    let upper: SemVer;
    if (base.major > 0) upper = { major: base.major + 1, minor: 0, patch: 0 };
    else if (base.minor > 0) upper = { major: 0, minor: base.minor + 1, patch: 0 };
    else upper = { major: 0, minor: 0, patch: base.patch + 1 };
    return cmp(v, upper) < 0;
  }

  // Prefix / partial / exact: "1", "1.2", "1.2.x", "1.2.3".
  const cleaned = r.replace(/\.(x|X|\*)/g, '').replace(/^(x|X|\*)$/, '');
  const segs = cleaned.split('.').filter((s) => s.length > 0);
  if (segs.length === 0) return true; // was all wildcards
  if (segs.some((s) => !/^\d+$/.test(s))) return false; // unparseable range
  const nums = segs.map(Number);
  if (nums.length >= 1 && nums[0] !== v.major) return false;
  if (nums.length >= 2 && nums[1] !== v.minor) return false;
  if (nums.length >= 3 && nums[2] !== v.patch) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Load every plugin manifest once (provider scan + cycle graph).
// ---------------------------------------------------------------------------

interface Manifest {
  id?: string;
  dependencies?: unknown;
  capabilities?: {
    requires?: Record<string, string>;
    provides?: Record<string, string>;
  };
}

function asStringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

function loadManifest(dir: string): Manifest | undefined {
  const p = join(dir, 'manifest.json');
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Manifest;
  } catch (e) {
    console.error(`❌ ${p} is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
}

const allManifests = new Map<string, Manifest>(); // id -> manifest
const idByDir = new Map<string, string>(); // dir -> id
if (existsSync(PLUGINS_DIR)) {
  for (const dir of readdirSync(PLUGINS_DIR).sort()) {
    const full = join(PLUGINS_DIR, dir);
    if (!statSync(full).isDirectory()) continue;
    const m = loadManifest(full);
    if (!m || typeof m.id !== 'string') continue;
    allManifests.set(m.id, m);
    idByDir.set(full, m.id);
  }
}

const manifest = loadManifest(pluginDir);
if (!manifest || typeof manifest.id !== 'string') {
  console.error(`❌ ${manifestPath} has no valid "id"`);
  process.exit(1);
}
const selfId = manifest.id;

const errors: string[] = [];
const notes: string[] = [];

// ---------------------------------------------------------------------------
// (1) Capability requires -> provider resolution.
// ---------------------------------------------------------------------------

const requires = asStringRecord(manifest.capabilities?.requires);
const requiresKeys = Object.keys(requires);

for (const cap of requiresKeys) {
  const range = requires[cap];
  const providers: string[] = [];
  let sawCapButBadVersion: string | undefined;

  for (const [id, m] of allManifests) {
    const provides = asStringRecord(m.capabilities?.provides);
    if (!(cap in provides)) continue;
    const provVer = provides[cap];
    if (satisfies(provVer, range)) {
      providers.push(`${id} (provides ${cap}@${provVer})`);
    } else {
      sawCapButBadVersion = `${id} provides ${cap}@${provVer}`;
    }
  }

  if (providers.length === 0) {
    if (sawCapButBadVersion) {
      errors.push(
        `required capability "${cap}@${range}" is UNSATISFIED — ` +
          `${sawCapButBadVersion} does not satisfy "${range}"`,
      );
    } else {
      errors.push(
        `required capability "${cap}@${range}" is UNSATISFIED — ` +
          `no installed plugin declares capabilities.provides["${cap}"]`,
      );
    }
  } else {
    notes.push(`requires ${cap}@${range} → satisfied by ${providers.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// (2) Cycle detection in the ID `dependencies` graph (reachable from selfId).
// ---------------------------------------------------------------------------

function depsOf(id: string): string[] {
  const m = allManifests.get(id);
  if (!m || !Array.isArray(m.dependencies)) return [];
  return (m.dependencies as unknown[]).filter((d): d is string => typeof d === 'string');
}

// DFS with a recursion stack; report the first cycle found that involves selfId's
// reachable subgraph. Also surfaces dangling (unknown) ID dependencies as errors.
const WHITE = 0,
  GRAY = 1,
  BLACK = 2;
const color = new Map<string, number>();
const stack: string[] = [];
let cyclePath: string[] | undefined;

function dfs(id: string): void {
  color.set(id, GRAY);
  stack.push(id);
  for (const dep of depsOf(id)) {
    if (!allManifests.has(dep)) {
      errors.push(`dependency "${dep}" of "${id}" is not a known plugin in ${PLUGINS_DIR}/`);
      continue;
    }
    const c = color.get(dep) ?? WHITE;
    if (c === GRAY) {
      // Found a back-edge -> cycle. Capture the slice from dep to current.
      const idx = stack.indexOf(dep);
      cyclePath = [...stack.slice(idx), dep];
      return;
    }
    if (c === WHITE) {
      dfs(dep);
      if (cyclePath) return;
    }
  }
  stack.pop();
  color.set(id, BLACK);
}

dfs(selfId);
if (cyclePath) {
  errors.push(`dependency cycle detected: ${cyclePath.join(' → ')}`);
}

// ---------------------------------------------------------------------------
// (3) Cross-check manifest capabilities.provides vs linked radix CID surface.
//     plugin.toml [capabilities.provided] is the radix-side provided surface.
// ---------------------------------------------------------------------------

const provides = asStringRecord(manifest.capabilities?.provides);
const tomlPath = join(pluginDir, 'plugin.toml');

if (existsSync(tomlPath)) {
  let doc: TomlTable | undefined;
  try {
    doc = parseToml(readFileSync(tomlPath, 'utf-8'));
  } catch (e) {
    const msg = e instanceof TomlError ? e.message : String(e);
    errors.push(`failed to parse ${tomlPath}: ${msg}`);
  }

  if (doc) {
    const caps = doc.capabilities;
    const capsTable =
      caps && typeof caps === 'object' && !Array.isArray(caps) ? (caps as TomlTable) : undefined;
    const providedRaw = capsTable?.provided;
    const cidProvided =
      providedRaw && typeof providedRaw === 'object' && !Array.isArray(providedRaw)
        ? (providedRaw as TomlTable)
        : undefined;

    if (cidProvided) {
      // Every capability the manifest claims to provide must appear in the CID
      // provided surface with a matching MAJOR (and vice versa), else the two
      // declarations have drifted.
      for (const cap of Object.keys(provides)) {
        if (!(cap in cidProvided)) {
          errors.push(
            `manifest declares capabilities.provides["${cap}"] but plugin.toml ` +
              `[capabilities.provided] has no "${cap}" — provided surfaces drift`,
          );
          continue;
        }
        const manVer = parseVersion(provides[cap]);
        const cidVerRaw = cidProvided[cap];
        const cidVer = typeof cidVerRaw === 'string' ? parseVersion(cidVerRaw) : undefined;
        if (manVer && cidVer && manVer.major !== cidVer.major) {
          errors.push(
            `capability "${cap}": manifest provides ${provides[cap]} (major ${manVer.major}) ` +
              `≠ plugin.toml provided ${String(cidVerRaw)} (major ${cidVer.major})`,
          );
        }
      }
      for (const cap of Object.keys(cidProvided)) {
        if (!(cap in provides)) {
          errors.push(
            `plugin.toml [capabilities.provided] declares "${cap}" but manifest ` +
              `capabilities.provides does not — provided surfaces drift`,
          );
        }
      }
      if (Object.keys(provides).length > 0) {
        notes.push(
          `provides ${Object.keys(provides).join(', ')} — cross-checked against plugin.toml CID surface`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

if (requiresKeys.length === 0 && Object.keys(provides).length === 0 && !errors.length) {
  console.log(
    `✅ Dependencies: ${selfId} declares no capabilities.requires/provides — non-consumer (skip)`,
  );
  process.exit(0);
}

if (errors.length > 0) {
  console.error(`❌ Dependency validation FAILED for ${selfId}:`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

for (const n of notes) console.log(`   • ${n}`);
console.log(`✅ Dependencies valid: ${selfId}`);
