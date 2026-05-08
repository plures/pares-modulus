/**
 * Vault Plugin — Zero-Trust Secret Graph for pares-radix
 *
 * Architecture:
 * - Rust backend (pares-agens/crates/arca/vault.rs): AES-256-GCM encryption,
 *   Argon2id key derivation, lock/unlock lifecycle
 * - PluresDB: graph-native secret metadata (relationships, rotation history,
 *   blast radius analysis). Secrets themselves stored encrypted in vault.
 * - Praxis: access control rules as data. Policy-bound AI access.
 * - Chronos: full audit trail of every access, rotation, policy change
 * - design-dojo: all UI components
 *
 * MCP tools (for AI access):
 * - vault.list — list secret metadata (names, tags, relationships — NOT values)
 * - vault.get — retrieve a secret value (gated by Praxis policy)
 * - vault.set — store a secret
 * - vault.delete — remove a secret
 * - vault.rotate — rotate a secret and show blast radius
 * - vault.lock — lock the vault
 * - vault.unlock — unlock with master password
 * - vault.relationships — query secret dependency graph
 * - vault.blast-radius — show what breaks if a secret is rotated
 */

import type { RadixPlugin } from '@plures/pares-radix';

export const vaultPlugin: RadixPlugin = {
  id: 'vault',
  name: 'Vault',
  version: '0.1.0',
  icon: '🔐',
  description: 'Zero-trust secret graph — encrypted storage with rotation blast radius',
  dependencies: [],

  routes: [
    { path: '/', component: () => import('./pages/VaultDashboard.svelte'), title: 'Vault' },
    { path: '/secrets', component: () => import('./pages/SecretsList.svelte'), title: 'Secrets' },
    { path: '/relationships', component: () => import('./pages/RelationshipGraph.svelte'), title: 'Relationships' },
    { path: '/audit', component: () => import('./pages/AuditLog.svelte'), title: 'Audit Log' },
  ],

  navItems: [
    { href: '/vault', label: 'Vault', icon: '🔐' },
  ],

  settings: [
    { key: 'vault.autoLockMinutes', type: 'number', label: 'Auto-lock timeout (minutes)', default: 15, group: 'Security' },
    { key: 'vault.syncEnabled', type: 'toggle', label: 'Hyperswarm sync', default: false, group: 'Sync', description: 'Sync vault metadata across devices (encrypted values never leave this device)' },
  ],

  dashboardWidgets: [
    {
      id: 'vault.status',
      title: '🔐 Vault',
      component: () => import('./pages/widgets/VaultStatus.svelte'),
      colspan: 1,
      priority: 15,
    },
  ],

  rules: [
    // Praxis rules for vault access control
  ],

  expectations: [],
  constraints: [],

  async onActivate(_ctx) {
    // Initialize vault connection (Tauri command or PluresDB)
  },
};

export default vaultPlugin;
