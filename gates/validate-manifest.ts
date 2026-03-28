/**
 * Validate plugin manifest against schema.
 * Usage: npx tsx gates/validate-manifest.ts plugins/<name>
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error('Usage: validate-manifest.ts <plugin-dir>');
  process.exit(1);
}

const manifestPath = join(pluginDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`❌ No manifest.json found in ${pluginDir}`);
  process.exit(1);
}

const schemaPath = join('registry', 'schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

const errors: string[] = [];

// Check required fields
for (const field of schema.required ?? []) {
  if (!(field in manifest)) {
    errors.push(`Missing required field: "${field}"`);
  }
}

// Check id format
if (manifest.id && !/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
  errors.push(`Invalid id "${manifest.id}" — must be kebab-case starting with letter`);
}

// Check version format
if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
  errors.push(`Invalid version "${manifest.version}" — must be SemVer`);
}

// Check description length
if (manifest.description && manifest.description.length > 200) {
  errors.push(`Description too long (${manifest.description.length}/200 chars)`);
}

// Check entry file exists
if (manifest.entry) {
  const entryPath = join(pluginDir, manifest.entry);
  if (!existsSync(entryPath)) {
    errors.push(`Entry file "${manifest.entry}" not found at ${entryPath}`);
  }
}

// Check no extra fields
const allowed = new Set(Object.keys(schema.properties ?? {}));
for (const key of Object.keys(manifest)) {
  if (!allowed.has(key)) {
    errors.push(`Unknown field: "${key}"`);
  }
}

if (errors.length > 0) {
  console.error(`❌ Manifest validation failed for ${manifest.id ?? pluginDir}:`);
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
} else {
  console.log(`✅ Manifest valid: ${manifest.id} v${manifest.version}`);
}
