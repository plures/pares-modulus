/**
 * Validates the public, immutable native-extension catalog consumed by Radix.
 *
 * This is a publication-boundary validator. Product activation remains owned
 * by the Radix PX transition procedure; this gate only proves that Modulus is
 * publishing a complete, digest-pinned release that names a real host-effects
 * contract before an installer can resolve it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const catalogPath = process.argv[2] ?? 'registry/native-extensions/v1/index.json';
const contractsIndexPath = process.argv[3] ?? 'registry/contracts/index.json';
const extensionIdPattern = /^[a-z][a-z0-9-]*$/;
const semverPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;

interface PublishedContract {
  id: string;
  version: string;
  path: string;
  sha256: string;
}

interface ContractIndex {
  version: number;
  contracts: PublishedContract[];
}

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
  $schema?: string;
  catalog_version: number;
  releases: NativeExtensionRelease[];
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`published document is missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error(`${context} must contain exactly: ${allowed.join(', ')}`);
  }
}

function validatePublishedContract(contract: PublishedContract, contractsIndexDirectory: string): void {
  const contractPath = resolve(contractsIndexDirectory, '..', '..', contract.path);
  const source = readFileSync(contractPath);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== contract.sha256) {
    throw new Error(`host-effects contract digest does not match its publication index: ${contract.id}@${contract.version}`);
  }
}

function contractCid(release: NativeExtensionRelease): string {
  return release.host_effects_cid;
}

export function validateNativeExtensionCatalog(
  requestedCatalogPath = catalogPath,
  requestedContractsIndexPath = contractsIndexPath,
): void {
  const catalog = readJson<NativeExtensionCatalog>(requestedCatalogPath);
  const contracts = readJson<ContractIndex>(requestedContractsIndexPath);
  const catalogRecord = catalog as unknown as Record<string, unknown>;

  assertExactKeys(catalogRecord, ['$schema', 'catalog_version', 'releases'], requestedCatalogPath);
  if (catalog.$schema !== './schema.json' || catalog.catalog_version !== 1 || !Array.isArray(catalog.releases)) {
    throw new Error(`${requestedCatalogPath} must declare its v1 schema, catalog_version 1, and a releases array`);
  }
  if (contracts.version !== 1 || !Array.isArray(contracts.contracts)) {
    throw new Error(`${requestedContractsIndexPath} must declare version 1 and a contracts array`);
  }

  const publishedContracts = new Map<string, PublishedContract>();
  for (const contract of contracts.contracts) {
    if (!contract.id || !semverPattern.test(contract.version) || !contract.path || !digestPattern.test(contract.sha256)) {
      throw new Error(`invalid host-effects publication record: ${JSON.stringify(contract)}`);
    }
    const key = `${contract.id}@${contract.version}`;
    if (publishedContracts.has(key)) {
      throw new Error(`duplicate host-effects publication record: ${key}`);
    }
    validatePublishedContract(contract, dirname(requestedContractsIndexPath));
    publishedContracts.set(key, contract);
  }

  const releases = new Set<string>();
  for (const release of catalog.releases) {
    assertExactKeys(release as unknown as Record<string, unknown>, [
      'artifact_sha256',
      'artifact_url',
      'extension_id',
      'host_effects_cid',
      'source_repository',
      'source_revision',
      'version',
    ], `native release ${release.extension_id ?? '<unknown>'}`);
    if (!extensionIdPattern.test(release.extension_id) || !semverPattern.test(release.version)) {
      throw new Error(`native release identity is invalid: ${release.extension_id}@${release.version}`);
    }
    if (!digestPattern.test(release.artifact_sha256)) {
      throw new Error(`native release digest must be lowercase SHA-256: ${release.extension_id}@${release.version}`);
    }
    let artifactUrl: URL;
    try {
      artifactUrl = new URL(release.artifact_url);
    } catch {
      throw new Error(`native release artifact_url must be a valid HTTPS URL: ${release.extension_id}@${release.version}`);
    }
    if (artifactUrl.protocol !== 'https:' || !artifactUrl.pathname.endsWith('.tar.gz')) {
      throw new Error(`native release artifact must be an HTTPS tar.gz URL: ${release.extension_id}@${release.version}`);
    }
    if (release.source_repository !== 'plures/praxis-platform' || !revisionPattern.test(release.source_revision)) {
      throw new Error(`native release provenance must name an immutable praxis-platform commit: ${release.extension_id}@${release.version}`);
    }
    if (!publishedContracts.has(contractCid(release))) {
      throw new Error(`native release references an unpublished host-effects CID: ${contractCid(release)}`);
    }
    const releaseKey = `${release.extension_id}@${release.version}`;
    if (releases.has(releaseKey)) {
      throw new Error(`native release is not immutable: duplicate catalog entry ${releaseKey}`);
    }
    releases.add(releaseKey);
    console.log(`✓ ${releaseKey} -> ${contractCid(release)}`);
  }

  console.log(`✓ native extension catalog v1 (${catalog.releases.length} releases)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validateNativeExtensionCatalog();
}
