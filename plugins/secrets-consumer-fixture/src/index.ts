/**
 * secrets-consumer-fixture — a minimal pares-radix plugin that CONSUMES the
 * `secrets` capability. It declares `capabilities.requires.secrets = "^1"` in
 * manifest.json and does nothing else; its sole purpose is to let the
 * capability-deps gate (gates/validate-dependencies.ts) prove that:
 *
 *   1. secrets@^1 RESOLVES against secrets-provider's provides secrets@1.0.0
 *      (gate exit 0), and
 *   2. the requirement BITES — if the provider's provided version no longer
 *      satisfies ^1 (e.g. bumped to 2.x), the SAME consumer FAILS (gate exit 1).
 *
 * No direct function reference crosses the boundary (ADR-0011): a real consumer
 * would drive the provider via the mediated secrets.* request/result events.
 */

import type { RadixPlugin, PluginContext } from '@plures/pares-radix';

const secretsConsumerFixture: RadixPlugin = {
  id: 'secrets-consumer-fixture',
  name: 'Secrets Consumer Fixture',
  version: '0.1.0',
  icon: '🔑',
  description: 'Minimal consumer of the secrets@^1 capability (verification fixture).',

  async onActivate(_ctx: PluginContext) {
    // A real consumer would emit `secrets.unlock.requested` / `secrets.retrieve.requested`
    // events here and read the paired result events. The fixture stays inert.
     
    console.log('[secrets-consumer-fixture] activated — would use secrets@^1 via mediated events');
  },
};

export default secretsConsumerFixture;
