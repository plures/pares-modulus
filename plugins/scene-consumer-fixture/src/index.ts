/**
 * scene-consumer-fixture — a minimal pares-radix plugin that CONSUMES the
 * `scene` capability. It declares `capabilities.requires.scene = "^1"` in
 * manifest.json and does nothing else; its sole purpose is to let the
 * capability-deps gate (gates/validate-dependencies.ts) prove that:
 *
 *   1. scene@^1 RESOLVES against scene-provider's provides scene@1.0.0
 *      (gate exit 0), and
 *   2. the requirement BITES — if the provider's provided version no longer
 *      satisfies ^1 (e.g. bumped to 2.x), the SAME consumer FAILS (gate exit 1).
 *
 * No direct function reference crosses the boundary (ADR-0011): a real consumer
 * (the inner-space display layer) would drive the provider via the mediated
 * scene.* request/result events (spawn/move/enter_room/compose).
 */

import type { RadixPlugin, PluginContext } from '@plures/pares-radix';

const sceneConsumerFixture: RadixPlugin = {
  id: 'scene-consumer-fixture',
  name: 'Scene Consumer Fixture',
  version: '0.1.0',
  icon: '🛰️',
  description: 'Minimal consumer of the scene@^1 capability (verification fixture).',

  async onActivate(_ctx: PluginContext) {
    // A real consumer would emit `scene.entity.spawn.requested` /
    // `scene.compose.requested` events here and read the paired result events.
    // The fixture stays inert.
    // eslint-disable-next-line no-console
    console.log('[scene-consumer-fixture] activated — would use scene@^1 via mediated events');
  },
};

export default sceneConsumerFixture;
