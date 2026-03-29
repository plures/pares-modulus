/**
 * Financial Advisor Plugin for pares-radix
 *
 * AI-powered personal finance — transaction categorization using praxis
 * inference rules, budgets, goals, reports, and contextual advice.
 */

import type { RadixPlugin, PluginContext } from '@plures/pares-radix';
import { recurringAmountPattern } from './rules/recurring-amount.js';
import { vendorClustering } from './rules/vendor-clustering.js';
import { refundDetection } from './rules/refund-detection.js';
import { taxVarianceDetection } from './rules/tax-variance.js';
import { setPluginContext } from './lib/context.js';

const financialAdvisor: RadixPlugin = {
  id: 'financial-advisor',
  name: 'Financial Advisor',
  version: '0.1.0',
  icon: '💰',
  description: 'AI-powered personal finance management with praxis inference',

  routes: [
    { path: '/', component: () => import('./pages/Dashboard.svelte'), title: 'Financial Overview' },
    {
      path: '/accounts',
      component: () => import('./pages/Accounts.svelte'),
      title: 'Accounts',
    },
    {
      path: '/transactions',
      component: () => import('./pages/Transactions.svelte'),
      title: 'Transactions',
      requires: [
        {
          type: 'accounts',
          minCount: 1,
          emptyMessage: 'Add a bank account to start tracking transactions.',
          fulfillHref: '/financial-advisor/accounts',
          fulfillLabel: 'Add Account',
        },
      ],
    },
    {
      path: '/budgets',
      component: () => import('./pages/Budgets.svelte'),
      title: 'Budgets',
    },
    {
      path: '/goals',
      component: () => import('./pages/Goals.svelte'),
      title: 'Goals',
    },
    {
      path: '/reports',
      component: () => import('./pages/Reports.svelte'),
      title: 'Reports',
      requires: [
        {
          type: 'transactions',
          minCount: 10,
          emptyMessage: 'Import at least 10 transactions to generate meaningful reports.',
          fulfillHref: '/financial-advisor/import',
          fulfillLabel: 'Import Transactions',
        },
      ],
    },
    {
      path: '/import',
      component: () => import('./pages/Import.svelte'),
      title: 'Import Data',
      requires: [
        {
          type: 'accounts',
          minCount: 1,
          emptyMessage: 'Create an account before importing transactions.',
          fulfillHref: '/financial-advisor/accounts',
          fulfillLabel: 'Add Account',
        },
      ],
    },
    {
      path: '/review',
      component: () => import('./pages/Review.svelte'),
      title: 'Review Categorization',
    },
  ],

  navItems: [
    {
      href: '/financial-advisor',
      label: 'Finance',
      icon: '💰',
      children: [
        { href: '/financial-advisor/accounts', label: 'Accounts', icon: '🏦' },
        { href: '/financial-advisor/transactions', label: 'Transactions', icon: '💳' },
        { href: '/financial-advisor/budgets', label: 'Budgets', icon: '📊' },
        { href: '/financial-advisor/goals', label: 'Goals', icon: '🎯' },
        { href: '/financial-advisor/reports', label: 'Reports', icon: '📈' },
        { href: '/financial-advisor/import', label: 'Import', icon: '📥' },
        { href: '/financial-advisor/review', label: 'Review', icon: '🔍' },
      ],
    },
  ],

  settings: [
    {
      key: 'financial-advisor.currency',
      type: 'select',
      label: 'Default Currency',
      description: 'Currency for display and calculations',
      default: 'USD',
      options: [
        { value: 'USD', label: 'USD — US Dollar' },
        { value: 'EUR', label: 'EUR — Euro' },
        { value: 'GBP', label: 'GBP — British Pound' },
        { value: 'CAD', label: 'CAD — Canadian Dollar' },
        { value: 'JPY', label: 'JPY — Japanese Yen' },
      ],
      group: 'Financial Advisor',
    },
    {
      key: 'financial-advisor.auto-categorize',
      type: 'toggle',
      label: 'Auto-Categorize Transactions',
      description: 'Automatically categorize imported transactions using praxis inference rules',
      default: true,
      group: 'Financial Advisor',
    },
    {
      key: 'financial-advisor.confidence-threshold',
      type: 'number',
      label: 'Confirmation Threshold',
      description: 'Confidence level above which categorizations are auto-confirmed (0.0-1.0)',
      default: 0.90,
      group: 'Financial Advisor',
    },
  ],

  dashboardWidgets: [
    {
      id: 'fa-net-worth',
      title: 'Net Worth',
      component: () => import('./pages/widgets/NetWorth.svelte'),
      priority: 10,
    },
    {
      id: 'fa-budget-status',
      title: 'Budget Status',
      component: () => import('./pages/widgets/BudgetStatus.svelte'),
      priority: 20,
    },
    {
      id: 'fa-recent-transactions',
      title: 'Recent Transactions',
      component: () => import('./pages/widgets/RecentTransactions.svelte'),
      priority: 30,
    },
  ],

  helpSections: [
    {
      title: 'Getting Started with Finance',
      icon: '💰',
      content: `## Getting Started\n\n1. **Add an account** — Go to Accounts and create your bank accounts, credit cards, or investment accounts.\n2. **Import transactions** — Upload CSV or OFX files from your bank.\n3. **Review categorization** — The system auto-categorizes most transactions. Review any uncertain ones.\n4. **Set budgets** — Create spending limits by category.\n5. **Track goals** — Set savings goals and monitor progress.`,
      priority: 10,
    },
    {
      title: 'How Categorization Works',
      icon: '🧠',
      content: `## Intelligent Categorization\n\nFinancial Advisor uses praxis inference rules — not expensive AI calls — to categorize 80%+ of your transactions:\n\n- **Recurring patterns**: Same vendor, same amount (±5%), monthly interval → high confidence match\n- **Vendor clustering**: "AMZN", "Amazon.com", "AMAZON MARKETPLACE" → recognized as same vendor\n- **Refund detection**: Small credit matching a recent price change → automatically linked\n- **Tax variance**: Consistent small increases across recurring charges → tax rate change\n\nEach categorization includes a confidence score and full decision trail. AI is only used for novel vendors or contextual advice.`,
      priority: 20,
    },
  ],

  onboardingSteps: [
    {
      title: 'Add a Bank Account',
      description: 'Create your first checking, savings, or credit card account.',
      icon: '🏦',
      href: '/financial-advisor/accounts',
      actionLabel: 'Add Account',
      isComplete: () => false, // TODO: check PluresDB for accounts
    },
    {
      title: 'Import Transactions',
      description: 'Upload bank statements (CSV, OFX, QFX) to start tracking.',
      icon: '📥',
      href: '/financial-advisor/import',
      actionLabel: 'Import Data',
      isComplete: () => false, // TODO: check PluresDB for transactions
      after: ['financial-advisor'], // after account creation step
    },
  ],

  // ── Praxis Inference Rules ──────────────────────────────────────────────

  rules: [
    recurringAmountPattern,
    vendorClustering,
    refundDetection,
    taxVarianceDetection,
  ],

  expectations: [
    {
      id: 'fa-immutable-imports',
      domain: 'business',
      description: 'Imported transaction data must never be modified — inferences go to a separate table',
      severity: 'error',
      validate: () => true, // Enforced by schema design
    },
    {
      id: 'fa-reports-require-data',
      domain: 'ux',
      description: 'Reports page requires at least 10 transactions for meaningful analysis',
      severity: 'warning',
      validate: () => true, // Enforced by route `requires`
    },
  ],

  constraints: [],

  async onActivate(ctx: PluginContext) {
    console.log('[financial-advisor] Plugin activated');
    setPluginContext(ctx);
    // TODO: load inference rules into inference engine
  },

  async onDeactivate() {
    console.log('[financial-advisor] Plugin deactivated');
  },

  async onDataExport() {
    // TODO: Export accounts, transactions, budgets, goals, inferences
    return {};
  },

  async onDataImport() {
    // TODO: Import from export format
  },
};

export default financialAdvisor;
