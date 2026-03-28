/**
 * Build registry/index.json from all plugin manifest.json files.
 * Run after merging new plugins or updating existing ones.
 *
 * Usage: npx tsx scripts/build-registry.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const PLUGINS_DIR = 'plugins';
const REGISTRY_PATH = 'registry/index.json';

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
  const hasTests = existsSync(join(pluginPath, 'tests')) &&
    readdirSync(join(pluginPath, 'tests')).length > 0;

  // Determine status
  const hasSource = existsSync(join(pluginPath, 'src'));
  const status = manifest.version === '0.0.1' || !hasSource ? 'planned' :
    manifest.version.startsWith('0.') ? 'development' : 'stable';

  plugins.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    icon: manifest.icon ?? '📦',
    keywords: manifest.keywords ?? [],
    radix: manifest.radix ?? '>=0.1.0',
    size: manifest.size?.source ?? '0KB',
    path: pluginPath,
    tested: hasTests,
    status,
  });

  console.log(`  ✓ ${manifest.id} v${manifest.version} (${status}${hasTests ? ', tested' : ''})`);
}

const registry = {
  version: 1,
  generated: new Date().toISOString(),
  plugins,
};

writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
console.log(`\n✅ Registry built: ${plugins.length} plugins → ${REGISTRY_PATH}`);
