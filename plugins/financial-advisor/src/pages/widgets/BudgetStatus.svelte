<script lang="ts">
  import { onMount } from 'svelte';
  import { getPluginContext } from '../../lib/context.js';
  import {
    FA_TRANSACTIONS_COLLECTION,
    FA_INFERENCES_COLLECTION,
    type Transaction,
    type TransactionInference,
  } from '../../lib/transactions.js';
  import {
    FA_BUDGETS_COLLECTION,
    budgetStatus,
    spendPercent,
    currentMonthPrefix,
    type Budget,
    type BudgetStatus,
  } from '../../lib/budgets.js';

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const fmt = (n: number) => currencyFormatter.format(n);

  // ── State ─────────────────────────────────────────────────────────────────
  let loading = $state(true);
  let transactions = $state<Transaction[]>([]);
  let inferences = $state<TransactionInference[]>([]);
  let budgets = $state<Budget[]>([]);

  // ── Derived: category inference lookup ───────────────────────────────────
  const catMap = $derived(
    new Map<string, string>(
      inferences
        .filter(inf => inf.field === 'category' && typeof inf.value === 'string')
        .map(inf => [inf.transactionId, inf.value as string]),
    ),
  );

  // ── Derived: top 3 budgets by % spent this month ─────────────────────────
  interface BudgetRow {
    budget: Budget;
    actual: number;
    pct: number;
    status: BudgetStatus;
  }

  const currentPrefix = $derived(currentMonthPrefix());

  const topBudgets = $derived<BudgetRow[]>(
    (() => {
      // Accumulate debit spend per category for the current calendar month.
      const spend: Record<string, number> = {};
      for (const tx of transactions) {
        if (!tx.date.startsWith(currentPrefix)) continue;
        if (tx.amount >= 0) continue; // skip income / credits
        const cat = catMap.get(tx.id);
        if (!cat) continue;
        spend[cat] = (spend[cat] ?? 0) + Math.abs(tx.amount);
      }

      return budgets
        .map(b => ({
          budget: b,
          actual: spend[b.category] ?? 0,
          pct: spendPercent(b, spend[b.category] ?? 0),
          status: budgetStatus(b, spend[b.category] ?? 0),
        }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3);
    })(),
  );

  // ── Load data on mount ────────────────────────────────────────────────────
  onMount(() => {
    const ctx = getPluginContext();
    if (!ctx) {
      loading = false;
      return;
    }
    Promise.all([
      ctx.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION).query(),
      ctx.data
        .collection<TransactionInference>(FA_INFERENCES_COLLECTION)
        .query({ field: 'category' }),
      ctx.data.collection<Budget>(FA_BUDGETS_COLLECTION).query(),
    ])
      .then(([txs, infs, bgets]) => {
        transactions = txs;
        inferences = infs;
        budgets = bgets;
      })
      .catch((error) => {
        ctx.notify?.error?.(
          `Failed to load budget status data${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
        );
      })
      .finally(() => {
        loading = false;
      });
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const STATUS_COLORS: Record<BudgetStatus, string> = {
    ok: 'var(--color-success, #16a34a)',
    warning: 'var(--color-warning, #d97706)',
    over: 'var(--color-danger, #dc2626)',
  };

  const STATUS_LABELS: Record<BudgetStatus, string> = {
    ok: 'On track',
    warning: 'Near limit',
    over: 'Over budget',
  };
</script>

<div class="widget" aria-label="Budget Status">
  {#if loading}
    <div class="widget__skeleton" aria-busy="true" aria-label="Loading budget status">
      {#each [1, 2, 3] as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>

  {:else if budgets.length === 0}
    <div class="widget__empty" role="region" aria-label="No budgets set up">
      <span class="widget__empty-icon" aria-hidden="true">📊</span>
      <p class="widget__empty-text">No budgets set up yet.</p>
    </div>

  {:else}
    <ul class="budget-list" aria-label="Top budgets by spending">
      {#each topBudgets as row (row.budget.id)}
        {@const color = STATUS_COLORS[row.status]}
        <li class="budget-item">
          <div class="budget-item__header">
            <span class="budget-item__category">{row.budget.category}</span>
            <span
              class="budget-item__pct"
              style:color={color}
              aria-label={`${Math.round(row.pct)}% spent`}
            >
              {Math.round(row.pct)}%
            </span>
          </div>
          <!-- Mini progress bar -->
          <div
            class="progress-track"
            role="progressbar"
            aria-valuenow={row.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${row.budget.category}: ${Math.round(row.pct)}% of budget used`}
          >
            <div
              class="progress-fill"
              style:width={`${row.pct}%`}
              style:background={color}
            ></div>
          </div>
          <div class="budget-item__sub">
            <span class="budget-item__amounts">
              {fmt(row.actual)} / {fmt(row.budget.monthlyLimit)}
            </span>
            <span
              class="budget-item__status"
              style:color={color}
            >
              {STATUS_LABELS[row.status]}
            </span>
          </div>
        </li>
      {/each}
    </ul>
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
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
  }

  .skeleton-row {
    height: 3.5rem;
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

  /* ── Budget list ───────────────────────────────────────────────────────── */
  .budget-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 1rem);
  }

  /* ── Budget item ───────────────────────────────────────────────────────── */
  .budget-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }

  .budget-item__header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .budget-item__category {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 70%;
  }

  .budget-item__pct {
    font-size: 0.875rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  /* ── Progress bar ──────────────────────────────────────────────────────── */
  .progress-track {
    width: 100%;
    height: 6px;
    background: var(--color-surface-2, #f3f4f6);
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: var(--radius-full, 9999px);
    transition: width 0.3s ease;
    min-width: 2px;
  }

  /* ── Sub-row: amounts + status label ───────────────────────────────────── */
  .budget-item__sub {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .budget-item__amounts {
    font-size: 0.75rem;
    color: var(--color-text-muted, #6b7280);
  }

  .budget-item__status {
    font-size: 0.75rem;
    font-weight: 500;
  }
</style>
