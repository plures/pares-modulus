/**
 * Validates the versioned Radix host-effect publication surface.
 *
 * This is a registry gate, not product runtime logic. It keeps the published
 * contract complete and self-consistent before installers/extensions consume it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

interface PublishedContract {
  id: string;
  version: string;
  radix: string;
  path: string;
  sha256: string;
}

interface HostProcess {
  process_id: string;
  orchestrator_id: string;
  adjacency_queue_capacity: number;
  restart_policy: string;
  latency_class: string;
}

interface HostEffectsContract {
  contract_id: string;
  version: string;
  processes: HostProcess[];
}

const indexPath = 'registry/contracts/index.json';
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
  version: number;
  contracts: PublishedContract[];
};

if (index.version !== 1 || !Array.isArray(index.contracts)) {
  throw new Error(`${indexPath} must declare version 1 and a contracts array`);
}

for (const published of index.contracts) {
  if (!existsSync(published.path)) {
    throw new Error(`published contract missing: ${published.path}`);
  }
  const source = readFileSync(published.path);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== published.sha256) {
    throw new Error(`${published.id}@${published.version} digest does not match index`);
  }

  const contract = JSON.parse(source.toString('utf8')) as HostEffectsContract;
  if (contract.contract_id !== published.id || contract.version !== published.version) {
    throw new Error(`${published.path} identity does not match the publication index`);
  }
  const ids = new Set<string>();
  for (const process of contract.processes) {
    if (!process.process_id || !process.orchestrator_id) {
      throw new Error(`${published.id}@${published.version} has an unnamed process`);
    }
    if (process.adjacency_queue_capacity <= 0) {
      throw new Error(`${process.process_id} must declare a bounded positive queue capacity`);
    }
    if (!ids.add(process.process_id)) {
      throw new Error(`${published.id}@${published.version} declares duplicate process ${process.process_id}`);
    }
  }
  if (contract.processes.length === 0) {
    throw new Error(`${published.id}@${published.version} must declare at least one process`);
  }
  console.log(`✓ ${published.id}@${published.version} (${contract.processes.length} processes)`);
}
