/**
 * Build registry/index.json from all plugin manifest.json files.
 * Run after merging new plugins or updating existing ones.
 *
 * Usage: npx tsx scripts/build-registry.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, sep } from 'path';

const PLUGINS_DIR = 'plugins';
const REGISTRY_PATH = 'registry/index.json';

interface PluginCapabilities {
  requires?: Record<string, string>;
  provides?: Record<string, string>;
}

interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  keywords: string[];
  radix: string;
  size: string;
  path: string;
  tested: boolean;
  status: 'development' | 'stable' | 'deprecated' | 'planned';
  /** Capability-aware dependencies surfaced from the manifest (ADR-0022/0024). */
  capabilities?: PluginCapabilities;
}

/** Real recursive byte size of a plugin dir, skipping node_modules/.git/dist. */
function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) total += dirSize(full);
    else total += st.size;
  }
  return total;
}

/** Real test presence: a tests/ dir with files, or any *.test.* / *.spec.* on disk. */
function hasTestFiles(dir: string): boolean {
  let found = false;
  function walk(d: string): void {
    if (found) return;
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry)) {
        found = true;
        return;
      }
    }
  }
  walk(dir);
  return found;
}

const plugins: RegistryEntry[] = [];

for (const dir of readdirSync(PLUGINS_DIR).sort()) {
  const pluginPath = join(PLUGINS_DIR, dir);
  if (!statSync(pluginPath).isDirectory()) continue;

  const manifestPath = join(pluginPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.warn(`⚠️ Skipping ${dir}: no manifest.json`);
    continue;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // Real test presence from disk (fixes stale `tested` drift).
  const hasTests = hasTestFiles(pluginPath);

  // Real on-disk size (fixes stale self-reported `size` drift).
  const bytes = dirSize(pluginPath);
  const sizeStr = `${Math.max(1, Math.round(bytes / 1024))}KB`;

  // Determine status
  const hasSource = existsSync(join(pluginPath, 'src'));
  const status = manifest.version === '0.0.1' || !hasSource ? 'planned' :
    manifest.version.startsWith('0.') ? 'development' : 'stable';

  // Surface capability-aware deps (only when declared).
  let capabilities: PluginCapabilities | undefined;
  const capRaw = manifest.capabilities;
  if (capRaw && typeof capRaw === 'object') {
    const reqKeys = capRaw.requires && Object.keys(capRaw.requires).length > 0;
    const provKeys = capRaw.provides && Object.keys(capRaw.provides).length > 0;
    if (reqKeys || provKeys) {
      capabilities = {};
      if (reqKeys) capabilities.requires = capRaw.requires;
      if (provKeys) capabilities.provides = capRaw.provides;
    }
  }

  plugins.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    icon: manifest.icon ?? '📦',
    keywords: manifest.keywords ?? [],
    radix: manifest.radix ?? '>=0.1.0',
    size: sizeStr,
    path: pluginPath.split(sep).join('/'),
    tested: hasTests,
    status,
    ...(capabilities ? { capabilities } : {}),
  });

  console.log(`  ✓ ${manifest.id} v${manifest.version} (${status}, ${sizeStr}${hasTests ? ', tested' : ''})`);
}

const registry = {
  version: 1,
  generated: new Date().toISOString(),
  plugins,
};

writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
console.log(`\n✅ Registry built: ${plugins.length} plugins → ${REGISTRY_PATH}`);
