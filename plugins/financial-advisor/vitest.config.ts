import { defineConfig } from 'vitest/config';

/**
 * Channel-independent test config for the financial-advisor plugin (C-TEST-002).
 *
 * Tests exercise the plugin's pure-TS lib modules (parsers, types, migrate)
 * against a real PluginContext built over an IN-MEMORY PluresDBGraph — a
 * legitimate test double at the storage boundary (AGENTS.md), never a runtime
 * stub. No Svelte/DOM rendering is required, so the default node environment
 * is used.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
