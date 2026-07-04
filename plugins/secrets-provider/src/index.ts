/**
 * secrets-provider — pares-radix plugin entry.
 *
 * The REAL conformance provider for the `secrets@1.x` capability. Declares
 * `capabilities.provides.secrets = "1.0.0"` in manifest.json (the first real
 * provider declaration the capability-deps gate validates) and constructs the
 * provider live in onActivate (not dead code).
 *
 * The provider implements the non-deferred `secrets` CID surface over the live
 * ctx.data collection bridge with real AES-256-GCM field encryption + PBKDF2
 * key derivation (see src/crypto.ts for the honest PBKDF2-vs-Argon2id note).
 * The constructed provider is held on the plugin instance so a host event-bus
 * adapter (or the future vault UI plugin) can drive its mediated operations.
 */

import type { RadixPlugin, PluginContext } from '@plures/pares-radix';
import { createSecretsProvider, type SecretsProvider } from './provider.js';

export { createSecretsProvider } from './provider.js';
export {
  SecretsError,
  type SecretsErrorCode,
  type SecretsProvider,
  type CredentialMeta,
  type CredentialMetaPublic,
  type VaultStatePublic,
} from './provider.js';

/** The live provider instance, constructed in onActivate. */
let provider: SecretsProvider | undefined;

/** Accessor for the constructed provider (used by a host mediation adapter). */
export function getSecretsProvider(): SecretsProvider | undefined {
  return provider;
}

const secretsProvider: RadixPlugin = {
  id: 'secrets-provider',
  name: 'Secrets Provider',
  version: '1.0.0',
  icon: '🔐',
  description:
    'Zero-trust, locally-encrypted credential store (unlock/lock gated). ' +
    'Conformance provider for the secrets@1.x capability.',

  constraints: [],

  async onActivate(ctx: PluginContext) {
    // Construct the real provider over the live data bridge. This is the wired,
    // executable provider — not dead code. A host event-bus adapter routes the
    // CID request/result events to these methods (ADR-0011 mediated boundary).
    provider = createSecretsProvider(ctx);
     
    console.log('[secrets-provider] activated — secrets@1.0.0 provider ready (locked)');
  },

  async onDeactivate() {
    // Drop the provider reference; in-memory unlock state goes with it.
    provider = undefined;
     
    console.log('[secrets-provider] deactivated');
  },
};

export default secretsProvider;
