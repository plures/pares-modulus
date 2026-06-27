import { defineConfig } from 'vitest/config';

/**
 * Channel-independent test config for the secrets-provider plugin (C-TEST-002).
 *
 * Tests exercise the provider's pure-TS modules (crypto.ts + provider.ts)
 * against a real PluginContext built over an IN-MEMORY PluresDBGraph — a
 * legitimate test double at the STORAGE boundary (AGENTS.md), never a runtime
 * stub and never mock crypto (the AES-256-GCM / PBKDF2 is the real WebCrypto).
 * No Svelte/DOM rendering is required, so the default node environment is used;
 * Node 20+ exposes the WebCrypto SubtleCrypto the provider needs.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
