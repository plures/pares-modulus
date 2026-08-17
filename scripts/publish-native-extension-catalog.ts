import { existsSync, readFileSync, writeFileSync } from 'node:fs';

interface NativeExtensionRelease {
  extension_id: string;
  version: string;
  host_effects_cid: string;
  artifact_sha256: string;
  artifact_url: string;
  source_repository: string;
  source_revision: string;
}

interface NativeExtensionCatalog {
  catalog_version: number;
  releases: NativeExtensionRelease[];
}

const [catalogPath, releasePath] = process.argv.slice(2);
if (!catalogPath || !releasePath) {
  throw new Error('usage: publish-native-extension-catalog.ts <catalog-path> <release-json-path>');
}
if (!existsSync(catalogPath) || !existsSync(releasePath)) {
  throw new Error('catalog and release JSON files must exist');
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as NativeExtensionCatalog;
const release = JSON.parse(readFileSync(releasePath, 'utf8')) as NativeExtensionRelease;
const releaseKey = `${release.extension_id}@${release.version}`;
if (catalog.releases.some((candidate) => `${candidate.extension_id}@${candidate.version}` === releaseKey)) {
  throw new Error(`immutable native release already exists: ${releaseKey}`);
}

catalog.releases.push(release);
catalog.releases.sort((left, right) => {
  const leftKey = `${left.extension_id}@${left.version}`;
  const rightKey = `${right.extension_id}@${right.version}`;
  return leftKey.localeCompare(rightKey);
});
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`added ${releaseKey} to ${catalogPath}`);
