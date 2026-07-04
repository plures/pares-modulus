/**
 * scene-provider — pares-radix plugin entry.
 *
 * The REAL conformance provider for the `scene@1.x` capability. Declares
 * `capabilities.provides.scene = "1.0.0"` in manifest.json (the version the
 * capability-deps gate validates against a consumer's `requires`) and constructs
 * the provider live in onActivate (not dead code).
 *
 * The provider implements the non-deferred `scene` CID surface over the live
 * ctx.data collection bridge: it PROJECTS converged PluresDB game state into a
 * render-agnostic Render State View (RSV) read-model (project / project_entity /
 * derive_convergence / frontier) and accepts renderer writes ONLY as signed,
 * ownership-bounded Intents (submit_intent), after negotiating renderer
 * capability (announce_profile). convergence.* and signature.* are DERIVED
 * observations, never authored (render-convergence.px). The constructed provider
 * is held on the plugin instance so a host event-bus adapter (or the inner-space
 * renderer plugin) can drive its mediated operations (ADR-0011).
 */

import type { RadixPlugin, PluginContext } from '@plures/pares-radix';
import { createSceneProvider, type SceneProvider } from './provider.js';

export { createSceneProvider, confidenceFromStaleness } from './provider.js';
export {
  SceneError,
  CONTRACT_VERSION,
  CONFIDENCE_HORIZON_S,
  type SceneErrorCode,
  type SceneProvider,
  type Tier,
  type EntityKind,
  type IntentType,
  type SpatialMode,
  type Transform,
  type Convergence,
  type Vitals,
  type Presentation,
  type SignatureObservation,
  type RsvEntitySource,
  type RsvZoneSource,
  type IntentNode,
  type RsvEntity,
  type RsvZone,
  type RenderStateView,
  type SubmittedIntent,
  type SubmitIntentResult,
  type RendererProfile,
  type AnnounceProfileResult,
  type DeriveConvergenceResult,
  type DeferredResult,
} from './provider.js';

/** The live provider instance, constructed in onActivate. */
let provider: SceneProvider | undefined;

/** Accessor for the constructed provider (used by a host mediation adapter). */
export function getSceneProvider(): SceneProvider | undefined {
  return provider;
}

const sceneProvider: RadixPlugin = {
  id: 'scene-provider',
  name: 'Scene Provider',
  version: '1.0.0',
  icon: '🎬',
  description:
    'Render-agnostic scene state: a derived Render State View read-model + a ' +
    'signed, ownership-bounded Intent write-model. Conformance provider for the ' +
    'scene@1.x capability.',

  constraints: [],

  async onActivate(ctx: PluginContext) {
    // Construct the real provider over the live data bridge. This is the wired,
    // executable provider — not dead code. A host event-bus adapter routes the
    // CID request/result events to these methods (ADR-0011 mediated boundary).
    provider = createSceneProvider(ctx);
     
    console.log('[scene-provider] activated — scene@1.0.0 provider ready');
  },

  async onDeactivate() {
    // Drop the provider reference. The scene source nodes persist in ctx.data.
    provider = undefined;
     
    console.log('[scene-provider] deactivated');
  },
};

export default sceneProvider;
