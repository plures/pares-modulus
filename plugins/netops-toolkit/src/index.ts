/**
 * Netops Toolkit Plugin for pares-radix
 *
 * Network operations toolkit: device inventory, scanning, health monitoring,
 * config management, and credential vault.
 */

import type { RadixPlugin } from '@plures/pares-radix';

const netopsToolkit: RadixPlugin = {
  id: 'netops-toolkit',
  name: 'Netops Toolkit',
  version: '0.1.0',
  icon: '🌐',
  description: 'Network diagnostics, topology visualization, and monitoring',

  routes: [
    {
      path: '/',
      component: () => import('./pages/Inventory.svelte'),
      title: 'Network Inventory',
    },
    {
      path: '/inventory',
      component: () => import('./pages/Inventory.svelte'),
      title: 'Device Inventory',
    },
    {
      path: '/scan',
      component: () => import('./pages/Scan.svelte'),
      title: 'Scan Network',
    },
    {
      path: '/health',
      component: () => import('./pages/Health.svelte'),
      title: 'Health Dashboard',
    },
    {
      path: '/config',
      component: () => import('./pages/Config.svelte'),
      title: 'Config Backups',
    },
    {
      path: '/vault',
      component: () => import('./pages/Vault.svelte'),
      title: 'Credential Vault',
    },
  ],

  navItems: [
    {
      href: '/netops-toolkit',
      label: 'Netops',
      icon: '🌐',
      children: [
        { href: '/netops-toolkit/inventory', label: 'Inventory', icon: '📋' },
        { href: '/netops-toolkit/scan', label: 'Scan', icon: '🔍' },
        { href: '/netops-toolkit/health', label: 'Health', icon: '❤️' },
        { href: '/netops-toolkit/config', label: 'Config', icon: '⚙️' },
        { href: '/netops-toolkit/vault', label: 'Vault', icon: '🔐' },
      ],
    },
  ],

  settings: {
    schema: {
      defaultUsername: {
        type: 'string',
        title: 'Default SSH Username',
        description: 'Username for SSH connections when no credential is found',
        default: 'admin',
      },
      scanTimeout: {
        type: 'number',
        title: 'Scan Timeout (seconds)',
        description: 'Maximum time to wait for device responses during scanning',
        default: 10,
        minimum: 1,
        maximum: 60,
      },
      autoRefresh: {
        type: 'boolean',
        title: 'Auto-refresh Health Data',
        description: 'Automatically refresh health dashboard every 30 seconds',
        default: false,
      },
      backupRetention: {
        type: 'number',
        title: 'Config Backup Retention (days)',
        description: 'Number of days to keep config backups',
        default: 30,
        minimum: 1,
        maximum: 365,
      },
    },
  },

  widgets: [
    {
      id: 'netops-summary',
      title: 'Network Summary',
      component: () => import('./pages/widgets/NetworkSummary.svelte'),
      defaultSize: { width: 2, height: 1 },
    },
  ],

  onLoad: async (context) => {
    console.log('[netops-toolkit] Plugin loaded', context);
  },

  onUnload: async () => {
    console.log('[netops-toolkit] Plugin unloaded');
  },
};

export default netopsToolkit;
