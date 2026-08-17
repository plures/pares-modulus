import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateNativeExtensionCatalog } from './validate-native-extension-catalog.js';

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'modulus-native-catalog-'));

try {
  const contractsDirectory = join(fixtureDirectory, 'registry', 'contracts');
  mkdirSync(contractsDirectory, { recursive: true });
  const contractPath = join(contractsDirectory, 'radix-host-effects-1.0.0.json');
  const contractSource = '{"contract_id":"radix-host-effects","version":"1.0.0","processes":[]}\r\n';
  writeFileSync(contractPath, contractSource);
  const contractDigest = createHash('sha256')
    .update(contractSource.replace(/\r\n/g, '\n'))
    .digest('hex');
  const contractsIndexPath = join(contractsDirectory, 'index.json');
  writeFileSync(contractsIndexPath, JSON.stringify({
    version: 1,
    contracts: [{
      id: 'radix-host-effects',
      version: '1.0.0',
      path: 'registry/contracts/radix-host-effects-1.0.0.json',
      sha256: contractDigest,
    }],
  }));

  const validCatalogPath = join(fixtureDirectory, 'valid.json');
  writeFileSync(validCatalogPath, JSON.stringify({
    $schema: './schema.json',
    catalog_version: 1,
    releases: [{
      extension_id: 'procedure-ledger',
      version: '0.1.0',
      host_effects_cid: 'radix-host-effects@1.0.0',
      artifact_sha256: 'a'.repeat(64),
      artifact_url: 'https://github.com/plures/pares-modulus/releases/download/native-procedure-ledger-v0.1.0/procedure-ledger-0.1.0.tar.gz',
      source_repository: 'plures/praxis-platform',
      source_revision: 'b'.repeat(40),
    }],
  }));
  validateNativeExtensionCatalog(validCatalogPath, contractsIndexPath);

  const mismatchedCidPath = join(fixtureDirectory, 'mismatched-cid.json');
  writeFileSync(mismatchedCidPath, JSON.stringify({
    $schema: './schema.json',
    catalog_version: 1,
    releases: [{
      extension_id: 'procedure-ledger',
      version: '0.1.0',
      host_effects_cid: 'radix-host-effects@0.1.0',
      artifact_sha256: 'a'.repeat(64),
      artifact_url: 'https://github.com/plures/pares-modulus/releases/download/native-procedure-ledger-v0.1.0/procedure-ledger-0.1.0.tar.gz',
      source_repository: 'plures/praxis-platform',
      source_revision: 'b'.repeat(40),
    }],
  }));
  assert.throws(
    () => validateNativeExtensionCatalog(mismatchedCidPath, contractsIndexPath),
    /unpublished host-effects CID/,
  );

  const duplicatePath = join(fixtureDirectory, 'duplicate.json');
  writeFileSync(duplicatePath, JSON.stringify({
    $schema: './schema.json',
    catalog_version: 1,
    releases: Array.from({ length: 2 }, () => ({
      extension_id: 'procedure-ledger',
      version: '0.1.0',
      host_effects_cid: 'radix-host-effects@1.0.0',
      artifact_sha256: 'a'.repeat(64),
      artifact_url: 'https://github.com/plures/pares-modulus/releases/download/native-procedure-ledger-v0.1.0/procedure-ledger-0.1.0.tar.gz',
      source_repository: 'plures/praxis-platform',
      source_revision: 'b'.repeat(40),
    })),
  }));
  assert.throws(
    () => validateNativeExtensionCatalog(duplicatePath, contractsIndexPath),
    /not immutable/,
  );

  console.log('✓ native extension catalog gate rejects bad host CIDs and duplicate releases');
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
