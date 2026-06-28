import { defineConfig } from 'vitest/config';

/**
 * Channel-independent test config for the scene-provider plugin (C-TEST-002).
 *
 * Tests exercise the provider's pure-TS modules (provider.ts) against a real
 * PluginContext built over an IN-MEMORY graph — a legitimate test double at the
 * STORAGE boundary (AGENTS.md), never a runtime stub. The Render State View
 * projection + Intent validation logic under test is the REAL logic, not mocked.
 * No Svelte/DOM rendering is required, so the default node environment is used.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
