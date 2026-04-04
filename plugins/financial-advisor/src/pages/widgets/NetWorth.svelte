<script lang="ts">
  import { onMount } from 'svelte';
  import { getPluginContext } from '../../lib/context.js';
  import { FA_ACCOUNTS_COLLECTION, type Account } from '../../lib/accounts.js';
  import { FA_TRANSACTIONS_COLLECTION, type Transaction } from '../../lib/transactions.js';
  import { currentMonthPrefix, previousMonthPrefix } from '../../lib/budgets.js';

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const fmt = (n: number) => currencyFormatter.format(n);

  // ── State ─────────────────────────────────────────────────────────────────
  let loading = $state(true);
  let accounts = $state<Account[]>([]);
  let transactions = $state<Transaction[]>([]);

  // ── Derived: net worth breakdown ──────────────────────────────────────────
  const totalAssets = $derived(
    accounts
      .filter(a => a.type !== 'credit' || a.balance > 0)
      .reduce((sum, a) => sum + Math.max(a.balance, 0), 0),
  );

  const totalLiabilities = $derived(
    accounts
      .filter(a => a.type === 'credit' && a.balance < 0)
      .reduce((sum, a) => sum + Math.abs(a.balance), 0),
  );

  const netWorth = $derived(totalAssets - totalLiabilities);

  // ── Derived: trend arrow from current month vs previous month net ─────────
  // Positive net = income exceeded expenses = trend up.
  const currentPrefix = $derived(currentMonthPrefix());
  const previousPrefix = $derived(previousMonthPrefix());

  const currentMonthNet = $derived(
    transactions
      .filter(tx => tx.date.startsWith(currentPrefix))
      .reduce((sum, tx) => sum + tx.amount, 0),
  );

  const previousMonthNet = $derived(
    transactions
      .filter(tx => tx.date.startsWith(previousPrefix))
      .reduce((sum, tx) => sum + tx.amount, 0),
  );

  // Trend: improving if current month is better than previous month.
  // Falls back to net worth sign when no prior-month data exists.
  type Trend = 'up' | 'down' | 'neutral';
  const trend = $derived<Trend>((): Trend => {
    const hasCurrent = transactions.some(tx => tx.date.startsWith(currentPrefix));
    const hasPrevious = transactions.some(tx => tx.date.startsWith(previousPrefix));
    if (hasCurrent && hasPrevious) {
      return currentMonthNet >= previousMonthNet ? 'up' : 'down';
    }
    if (hasCurrent) {
      return currentMonthNet >= 0 ? 'up' : 'down';
    }
    if (accounts.length > 0) {
      return netWorth >= 0 ? 'up' : 'neutral';
    }
    return 'neutral';
  });

  // ── Load data on mount ────────────────────────────────────────────────────
  onMount(() => {
    const ctx = getPluginContext();
    if (!ctx) {
      loading = false;
      return;
    }
    Promise.all([
      ctx.data.collection<Account>(FA_ACCOUNTS_COLLECTION).query(),
      ctx.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION).query(),
    ])
      .then(([accts, txs]) => {
        accounts = accts;
        transactions = txs;
      })
      .catch(() => {
        /* show empty state on error */
      })
      .finally(() => {
        loading = false;
      });
  });
</script>

<div class="widget" aria-label="Net Worth">
  {#if loading}
    <div class="widget__skeleton" aria-busy="true" aria-label="Loading net worth"></div>

  {:else if accounts.length === 0}
    <div class="widget__empty" role="region" aria-label="No account data">
      <span class="widget__empty-icon" aria-hidden="true">💰</span>
      <p class="widget__empty-text">Add accounts to see your net worth.</p>
    </div>

  {:else}
    <div class="widget__content">
      <!-- Primary value + trend arrow -->
      <div class="net-worth__primary">
        <span
          class="net-worth__value"
          class:net-worth__value--positive={netWorth >= 0}
          class:net-worth__value--negative={netWorth < 0}
          aria-label={`Net worth: ${fmt(netWorth)}`}
        >
          {fmt(netWorth)}
        </span>
        {#if trend !== 'neutral'}
          <span
            class="net-worth__trend"
            class:net-worth__trend--up={trend === 'up'}
            class:net-worth__trend--down={trend === 'down'}
            aria-label={trend === 'up' ? 'Trending up' : 'Trending down'}
            role="img"
          >
            {trend === 'up' ? '↑' : '↓'}
          </span>
        {/if}
      </div>

      <!-- Assets / Liabilities breakdown -->
      <div class="net-worth__breakdown" aria-label="Net worth breakdown">
        <div class="net-worth__row">
          <span class="net-worth__row-label">Assets</span>
          <span class="net-worth__row-value net-worth__row-value--positive">
            {fmt(totalAssets)}
          </span>
        </div>
        <div class="net-worth__row">
          <span class="net-worth__row-label">Liabilities</span>
          <span class="net-worth__row-value net-worth__row-value--negative">
            {fmt(totalLiabilities)}
          </span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Widget shell ──────────────────────────────────────────────────────── */
  .widget {
    padding: var(--space-4, 1rem);
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* ── Loading skeleton ──────────────────────────────────────────────────── */
  .widget__skeleton {
    height: 6rem;
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-surface-2, #f3f4f6);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  /* ── Empty state ───────────────────────────────────────────────────────── */
  .widget__empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 0.5rem);
    text-align: center;
    padding: var(--space-4, 1rem);
  }

  .widget__empty-icon {
    font-size: 2rem;
  }

  .widget__empty-text {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0;
  }

  /* ── Content ───────────────────────────────────────────────────────────── */
  .widget__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
  }

  /* ── Primary row: value + trend arrow ─────────────────────────────────── */
  .net-worth__primary {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
  }

  .net-worth__value {
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1.1;
    color: var(--color-text, #111827);
  }

  .net-worth__value--positive {
    color: var(--color-success, #16a34a);
  }

  .net-worth__value--negative {
    color: var(--color-danger, #dc2626);
  }

  .net-worth__trend {
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1;
  }

  .net-worth__trend--up {
    color: var(--color-success, #16a34a);
  }

  .net-worth__trend--down {
    color: var(--color-danger, #dc2626);
  }

  /* ── Breakdown rows ────────────────────────────────────────────────────── */
  .net-worth__breakdown {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
    border-top: 1px solid var(--color-border, #e5e7eb);
    padding-top: var(--space-3, 0.75rem);
  }

  .net-worth__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
  }

  .net-worth__row-label {
    color: var(--color-text-muted, #6b7280);
  }

  .net-worth__row-value {
    font-weight: 600;
    color: var(--color-text, #111827);
  }

  .net-worth__row-value--positive {
    color: var(--color-success, #16a34a);
  }

  .net-worth__row-value--negative {
    color: var(--color-danger, #dc2626);
  }
</style>
