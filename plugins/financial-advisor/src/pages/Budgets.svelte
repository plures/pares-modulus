<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Input, Select, Dialog } from '@plures/design-dojo';
  import { getPluginContext } from '../lib/context.js';
  import {
    FA_BUDGETS_COLLECTION,
    generateBudgetId,
    budgetStatus,
    spendPercent,
    currentMonthPrefix,
    previousMonthPrefix,
    monthLabel,
    type Budget,
    type BudgetStatus,
  } from '../lib/budgets.js';
  import { FA_TRANSACTIONS_COLLECTION, FA_INFERENCES_COLLECTION } from '../lib/transactions.js';
  import type { Transaction, TransactionInference } from '../lib/transactions.js';
  import { BUDGET_CATEGORIES as CATEGORIES } from '../lib/categories.js';

  type PluginContext = NonNullable<ReturnType<typeof getPluginContext>>;
  type CollectionOf<T> = ReturnType<PluginContext['data']['collection']<T>>;

  let ctx: ReturnType<typeof getPluginContext>;
  let budgetCollection: CollectionOf<Budget>;
  let txCollection: CollectionOf<Transaction>;
  let infCollection: CollectionOf<TransactionInference>;

  // ── Page state ─────────────────────────────────────────────────────────────
  let budgets = $state<Budget[]>([]);
  let loading = $state(true);

  // ── Spending maps — keyed by category ─────────────────────────────────────
  let currentSpend = $state<Record<string, number>>({});
  let previousSpend = $state<Record<string, number>>({});

  // ── Form dialog state ──────────────────────────────────────────────────────
  let showForm = $state(false);
  let editingBudget = $state<Budget | null>(null);
  let saving = $state(false);
  let formError = $state('');

  // ── Form fields ────────────────────────────────────────────────────────────
  let formCategory = $state(CATEGORIES[0] as string);
  let formLimit = $state('');
  let formThreshold = $state('80');

  // ── Delete confirmation state ──────────────────────────────────────────────
  let confirmDeleteId = $state<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const isEditMode = $derived(editingBudget !== null);
  const confirmDeleteTarget = $derived(
    budgets.find(b => b.id === confirmDeleteId) ?? null,
  );

  /** Budgets sorted by status severity (over → warning → ok), then category. */
  const sortedBudgets = $derived(
    [...budgets].sort((a, b) => {
      const order: Record<BudgetStatus, number> = { over: 0, warning: 1, ok: 2 };
      const aStatus = budgetStatus(a, currentSpend[a.category] ?? 0);
      const bStatus = budgetStatus(b, currentSpend[b.category] ?? 0);
      if (order[aStatus] !== order[bStatus]) return order[aStatus] - order[bStatus];
      return a.category.localeCompare(b.category);
    }),
  );

  /** Categories not yet assigned a budget (for the create form). */
  const availableCategories = $derived(
    editingBudget
      ? CATEGORIES
      : CATEGORIES.filter(c => !budgets.some(b => b.category === c)),
  );

  const currentMonthLabel = $derived(monthLabel(currentMonthPrefix()));
  const previousMonthLabel = $derived(monthLabel(previousMonthPrefix()));

  // ── Load data on mount ─────────────────────────────────────────────────────
  onMount(() => {
    ctx = getPluginContext();
    budgetCollection = ctx?.data.collection<Budget>(FA_BUDGETS_COLLECTION);
    txCollection = ctx?.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION);
    infCollection = ctx?.data.collection<TransactionInference>(FA_INFERENCES_COLLECTION);
    loadAll().catch(() => {
      ctx?.notify.error('Failed to load budgets.');
      loading = false;
    });
  });

  async function loadAll(): Promise<void> {
    loading = true;
    try {
      budgets = (await budgetCollection?.query()) ?? [];
      await computeSpending();
    } catch {
      ctx?.notify.error('Failed to load budgets.');
      budgets = [];
    } finally {
      loading = false;
    }
  }

  // ── Compute spending per category for current and previous month ───────────
  async function computeSpending(): Promise<void> {
    const thisMo = currentMonthPrefix();
    const prevMo = previousMonthPrefix();

    const allTx: Transaction[] = (await txCollection?.query()) ?? [];
    const allInf: TransactionInference[] =
      (await infCollection?.query({ field: 'category' })) ?? [];

    // Build a map: transactionId → category
    const catMap = new Map<string, string>();
    for (const inf of allInf) {
      if (inf.field === 'category' && typeof inf.value === 'string') {
        catMap.set(inf.transactionId, inf.value);
      }
    }

    const curr: Record<string, number> = {};
    const prev: Record<string, number> = {};

    for (const tx of allTx) {
      // Only count debits (negative amounts = money going out)
      if (tx.amount >= 0) continue;
      const cat = catMap.get(tx.id);
      if (!cat) continue;
      const spend = Math.abs(tx.amount);

      if (tx.date.startsWith(thisMo)) {
        curr[cat] = (curr[cat] ?? 0) + spend;
      } else if (tx.date.startsWith(prevMo)) {
        prev[cat] = (prev[cat] ?? 0) + spend;
      }
    }

    currentSpend = curr;
    previousSpend = prev;
  }

  // ── Form helpers ───────────────────────────────────────────────────────────
  function openCreate(): void {
    editingBudget = null;
    formCategory = (availableCategories[0] as string) ?? (CATEGORIES[0] as string);
    formLimit = '';
    formThreshold = '80';
    formError = '';
    showForm = true;
  }

  function openEdit(budget: Budget): void {
    editingBudget = budget;
    formCategory = budget.category;
    formLimit = budget.monthlyLimit.toFixed(2);
    formThreshold = String(Math.round(budget.alertThreshold * 100));
    formError = '';
    showForm = true;
  }

  function closeForm(): void {
    showForm = false;
    editingBudget = null;
    formError = '';
  }

  async function saveBudget(): Promise<void> {
    formError = '';

    const limit = parseFloat(formLimit);
    if (!formCategory) {
      formError = 'Category is required.';
      return;
    }
    if (isNaN(limit) || limit <= 0) {
      formError = 'Monthly limit must be a positive number.';
      return;
    }
    const thresholdPct = parseFloat(formThreshold);
    if (isNaN(thresholdPct) || thresholdPct <= 0 || thresholdPct > 100) {
      formError = 'Alert threshold must be between 1 and 100.';
      return;
    }
    if (!budgetCollection) {
      formError = 'Database not available.';
      return;
    }

    // Prevent duplicate categories when creating
    if (!editingBudget && budgets.some(b => b.category === formCategory)) {
      formError = `A budget for "${formCategory}" already exists.`;
      return;
    }

    saving = true;
    try {
      const now = new Date().toISOString();
      const threshold = thresholdPct / 100;

      if (editingBudget) {
        const updated: Budget = {
          ...editingBudget,
          category: formCategory,
          monthlyLimit: limit,
          alertThreshold: threshold,
          updatedAt: now,
        };
        await budgetCollection.put(updated.id, updated);
        budgets = budgets.map(b => (b.id === updated.id ? updated : b));
        ctx?.notify.success('Budget updated.');
      } else {
        const budget: Budget = {
          id: generateBudgetId(),
          category: formCategory,
          monthlyLimit: limit,
          alertThreshold: threshold,
          createdAt: now,
          updatedAt: now,
        };
        await budgetCollection.put(budget.id, budget);
        budgets = [...budgets, budget];
        ctx?.notify.success('Budget created.');
      }
      closeForm();
    } catch {
      formError = 'Failed to save budget. Please try again.';
      ctx?.notify.error('Failed to save budget.');
    } finally {
      saving = false;
    }
  }

  async function deleteBudget(id: string): Promise<void> {
    if (!budgetCollection) return;
    try {
      await budgetCollection.delete(id);
      budgets = budgets.filter(b => b.id !== id);
      ctx?.notify.success('Budget deleted.');
    } catch {
      ctx?.notify.error('Failed to delete budget.');
    }
    confirmDeleteId = null;
  }

  // ── Formatting ─────────────────────────────────────────────────────────────
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }

  function statusIcon(status: BudgetStatus): string {
    if (status === 'over') return '🔴';
    if (status === 'warning') return '🟡';
    return '🟢';
  }

  function statusLabel(status: BudgetStatus): string {
    if (status === 'over') return 'Over budget';
    if (status === 'warning') return 'Near limit';
    return 'On track';
  }

  /** Month-over-month change label, e.g. "+$12.50 vs last month". */
  function momLabel(category: string): string {
    const curr = currentSpend[category] ?? 0;
    const prev = previousSpend[category] ?? 0;
    if (prev === 0 && curr === 0) return '';
    const diff = curr - prev;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${formatCurrency(diff)} vs ${previousMonthLabel}`;
  }

  /** CSS class for the mom change label. */
  function momClass(category: string): string {
    const diff = (currentSpend[category] ?? 0) - (previousSpend[category] ?? 0);
    if (diff > 0) return 'mom--up';
    if (diff < 0) return 'mom--down';
    return 'mom--neutral';
  }
</script>

<!-- ── Page ─────────────────────────────────────────────────────────────────── -->
<div class="budgets-page">
  <!-- Header -->
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">Budgets</h1>
      {#if budgets.length > 0}
        <p class="page-header__subtitle">
          {currentMonthLabel} ·
          {budgets.filter(b => budgetStatus(b, currentSpend[b.category] ?? 0) === 'over').length} over,
          {budgets.filter(b => budgetStatus(b, currentSpend[b.category] ?? 0) === 'warning').length} near limit
        </p>
      {/if}
    </div>
    {#if !loading && availableCategories.length > 0}
      <Button class="btn btn--primary" onclick={openCreate} aria-label="Add budget">
        + Add Budget
      </Button>
    {/if}
  </header>

  <!-- Loading skeleton -->
  {#if loading}
    <div class="skeleton-list" aria-busy="true" aria-label="Loading budgets">
      {#each [1, 2, 3] as _}
        <div class="skeleton-card"></div>
      {/each}
    </div>

  <!-- Empty state -->
  {:else if budgets.length === 0}
    <div class="empty-state" role="region" aria-label="No budgets yet">
      <span class="empty-state__icon" aria-hidden="true">📊</span>
      <h2 class="empty-state__heading">No budgets yet</h2>
      <p class="empty-state__body">
        Set monthly spending limits by category to keep your finances on track.
        You'll get warnings when you're approaching or over your limit.
      </p>
      <Button class="btn btn--primary btn--lg" onclick={openCreate}>
        Create Your First Budget
      </Button>
    </div>

  <!-- Budget list -->
  {:else}
    <ul class="budget-list" aria-label="Budget list">
      {#each sortedBudgets as budget (budget.id)}
        {@const actual = currentSpend[budget.category] ?? 0}
        {@const pct = spendPercent(budget, actual)}
        {@const status = budgetStatus(budget, actual)}
        {@const mom = momLabel(budget.category)}

        <li class="budget-card" class:budget-card--over={status === 'over'} class:budget-card--warning={status === 'warning'}>
          <!-- Card header -->
          <div class="budget-card__header">
            <div class="budget-card__title-row">
              <span class="budget-card__status-icon" aria-hidden="true">{statusIcon(status)}</span>
              <span class="budget-card__category">{budget.category}</span>
              <span
                class="budget-card__badge"
                class:budget-card__badge--over={status === 'over'}
                class:budget-card__badge--warning={status === 'warning'}
                class:budget-card__badge--ok={status === 'ok'}
              >
                {statusLabel(status)}
              </span>
            </div>
            <div class="budget-card__actions">
              <Button
                class="btn btn--ghost btn--sm"
                onclick={() => openEdit(budget)}
                aria-label={`Edit ${budget.category} budget`}
              >
                Edit
              </Button>
              <Button
                class="btn btn--ghost btn--sm btn--danger"
                onclick={() => (confirmDeleteId = budget.id)}
                aria-label={`Delete ${budget.category} budget`}
              >
                Delete
              </Button>
            </div>
          </div>

          <!-- Progress bar -->
          <div
            class="progress-wrap"
            role="meter"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${budget.category} spending: ${Math.round(pct)}% of budget`}
          >
            <div
              class="progress-bar"
              class:progress-bar--over={status === 'over'}
              class:progress-bar--warning={status === 'warning'}
              style={`width: ${pct}%`}
            ></div>
            <!-- Alert threshold marker -->
            <div
              class="progress-threshold"
              style={`left: ${budget.alertThreshold * 100}%`}
              aria-hidden="true"
              title={`Alert threshold: ${Math.round(budget.alertThreshold * 100)}%`}
            ></div>
          </div>

          <!-- Amounts row -->
          <div class="budget-card__amounts">
            <span class="budget-card__spent">
              <span class="budget-card__spent-value">{formatCurrency(actual)}</span>
              <span class="budget-card__spent-label"> spent</span>
            </span>
            <span class="budget-card__limit">
              of {formatCurrency(budget.monthlyLimit)}
            </span>
            <span class="budget-card__remaining">
              {#if actual < budget.monthlyLimit}
                {formatCurrency(budget.monthlyLimit - actual)} remaining
              {:else}
                {formatCurrency(actual - budget.monthlyLimit)} over
              {/if}
            </span>
          </div>

          <!-- Month-over-month comparison -->
          {#if mom}
            <p class={`mom ${momClass(budget.category)}`} aria-label="Month-over-month change">
              {mom}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- ── Budget form dialog ──────────────────────────────────────────────────── -->
{#if showForm}
  <Dialog
    onclose={closeForm}
    class="dialog"
    aria-modal="true"
    aria-labelledby="dialog-title"
  >
    <header class="dialog__header">
      <h2 class="dialog__title" id="dialog-title">
        {isEditMode ? 'Edit Budget' : 'Add Budget'}
      </h2>
      <Button
        class="btn btn--ghost btn--icon"
        onclick={closeForm}
        aria-label="Close dialog"
      >
        ✕
      </Button>
    </header>

    <form
      class="dialog__body"
      onsubmit={(e) => {
        e.preventDefault();
        saveBudget().catch(() => {
          formError = 'Failed to save budget. Please try again.';
        });
      }}
      novalidate
    >
      {#if formError}
        <p class="form-error" role="alert">{formError}</p>
      {/if}

      <div class="field">
        <label class="field__label" for="budget-category">
          Category <span aria-hidden="true">*</span>
        </label>
        {#if isEditMode}
          <!-- When editing, show category as read-only text (can't change the key) -->
          <Input
            id="budget-category"
            class="field__input"
            type="text"
            value={formCategory}
            disabled
            aria-readonly="true"
          />
        {:else}
          <Select id="budget-category" class="field__select" bind:value={formCategory}>
            {#each availableCategories as cat}
              <option value={cat}>{cat}</option>
            {/each}
          </Select>
        {/if}
      </div>

      <div class="field">
        <label class="field__label" for="budget-limit">
          Monthly Limit <span aria-hidden="true">*</span>
        </label>
        <div class="field__prefix-wrap">
          <span class="field__prefix" aria-hidden="true">$</span>
          <Input
            id="budget-limit"
            class="field__input field__input--prefixed"
            type="number"
            min="0.01"
            step="0.01"
            bind:value={formLimit}
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="budget-threshold">
          Alert Threshold (%)
          <span class="field__hint">Warn me when spending reaches this % of the limit</span>
        </label>
        <div class="field__suffix-wrap">
          <Input
            id="budget-threshold"
            class="field__input field__input--suffixed"
            type="number"
            min="1"
            max="100"
            step="1"
            bind:value={formThreshold}
            placeholder="80"
            required
          />
          <span class="field__suffix" aria-hidden="true">%</span>
        </div>
      </div>

      <footer class="dialog__footer">
        <Button
          class="btn btn--ghost"
          type="button"
          onclick={closeForm}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button class="btn btn--primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Add Budget'}
        </Button>
      </footer>
    </form>
  </Dialog>
{/if}

<!-- ── Delete confirmation dialog ─────────────────────────────────────────── -->
{#if confirmDeleteId !== null}
  <Dialog
    onclose={() => (confirmDeleteId = null)}
    class="dialog dialog--sm"
    aria-modal="true"
    aria-labelledby="confirm-title"
  >
    <header class="dialog__header">
      <h2 class="dialog__title" id="confirm-title">Delete Budget?</h2>
    </header>
    <div class="dialog__body">
      <p class="dialog__text">
        Are you sure you want to delete the budget for
        <strong>{confirmDeleteTarget?.category ?? 'this category'}</strong>?
        This action cannot be undone.
      </p>
    </div>
    <footer class="dialog__footer">
      <Button
        class="btn btn--ghost"
        onclick={() => (confirmDeleteId = null)}
      >
        Cancel
      </Button>
      <Button
        class="btn btn--danger"
        onclick={() => {
          if (confirmDeleteId) {
            deleteBudget(confirmDeleteId).catch(() => {
              ctx?.notify.error('Failed to delete budget.');
            });
          }
        }}
      >
        Delete
      </Button>
    </footer>
  </Dialog>
{/if}

<style>
  /* ── Layout ─────────────────────────────────────────────────────────────── */
  .budgets-page {
    padding: var(--space-6, 1.5rem);
    max-width: 48rem;
    margin: 0 auto;
  }

  /* ── Page header ─────────────────────────────────────────────────────────── */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4, 1rem);
    margin-bottom: var(--space-6, 1.5rem);
  }

  .page-header__title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    color: var(--color-text, #111827);
  }

  .page-header__subtitle {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: var(--space-1, 0.25rem) 0 0;
  }

  /* ── Skeleton loader ─────────────────────────────────────────────────────── */
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
  }

  .skeleton-card {
    height: 7rem;
    border-radius: var(--radius-lg, 0.75rem);
    background: var(--color-surface-2, #f3f4f6);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* ── Empty state ─────────────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-16, 4rem) var(--space-6, 1.5rem);
    gap: var(--space-4, 1rem);
  }

  .empty-state__icon {
    font-size: 3rem;
    line-height: 1;
  }

  .empty-state__heading {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: var(--color-text, #111827);
  }

  .empty-state__body {
    font-size: 0.9375rem;
    color: var(--color-text-muted, #6b7280);
    max-width: 28rem;
    margin: 0;
    line-height: 1.6;
  }

  /* ── Budget list ─────────────────────────────────────────────────────────── */
  .budget-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
  }

  .budget-card {
    padding: var(--space-4, 1rem) var(--space-5, 1.25rem);
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    transition: box-shadow 0.15s ease;
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
  }

  .budget-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .budget-card--over {
    border-color: var(--color-danger-border, #fecaca);
    background: var(--color-danger-subtle, #fef2f2);
  }

  .budget-card--warning {
    border-color: var(--color-warning-border, #fde68a);
    background: var(--color-warning-subtle, #fffbeb);
  }

  /* ── Card header ─────────────────────────────────────────────────────────── */
  .budget-card__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3, 0.75rem);
    flex-wrap: wrap;
  }

  .budget-card__title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    flex: 1;
    min-width: 0;
  }

  .budget-card__status-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .budget-card__category {
    font-weight: 600;
    font-size: 1rem;
    color: var(--color-text, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .budget-card__badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-full, 9999px);
    font-size: 0.75rem;
    font-weight: 500;
    flex-shrink: 0;
  }

  .budget-card__badge--ok {
    background: var(--color-success-subtle, #f0fdf4);
    color: var(--color-success, #16a34a);
    border: 1px solid var(--color-success-border, #bbf7d0);
  }

  .budget-card__badge--warning {
    background: var(--color-warning-subtle, #fffbeb);
    color: var(--color-warning, #d97706);
    border: 1px solid var(--color-warning-border, #fde68a);
  }

  .budget-card__badge--over {
    background: var(--color-danger-subtle, #fef2f2);
    color: var(--color-danger, #dc2626);
    border: 1px solid var(--color-danger-border, #fecaca);
  }

  .budget-card__actions {
    display: flex;
    gap: var(--space-2, 0.5rem);
    flex-shrink: 0;
  }

  /* ── Progress bar ────────────────────────────────────────────────────────── */
  .progress-wrap {
    position: relative;
    height: 0.625rem;
    background: var(--color-surface-2, #f3f4f6);
    border-radius: var(--radius-full, 9999px);
    overflow: visible;
  }

  .progress-bar {
    height: 100%;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-primary, #6366f1);
    transition: width 0.3s ease;
    max-width: 100%;
  }

  .progress-bar--warning {
    background: var(--color-warning, #d97706);
  }

  .progress-bar--over {
    background: var(--color-danger, #dc2626);
  }

  /* Threshold marker — a vertical tick on the track */
  .progress-threshold {
    position: absolute;
    top: -0.125rem;
    bottom: -0.125rem;
    width: 2px;
    background: var(--color-text-subtle, #9ca3af);
    border-radius: 1px;
    transform: translateX(-50%);
    pointer-events: none;
  }

  /* ── Amounts row ─────────────────────────────────────────────────────────── */
  .budget-card__amounts {
    display: flex;
    align-items: baseline;
    gap: var(--space-3, 0.75rem);
    font-size: 0.875rem;
    flex-wrap: wrap;
  }

  .budget-card__spent {
    color: var(--color-text, #111827);
  }

  .budget-card__spent-value {
    font-weight: 600;
  }

  .budget-card__spent-label {
    color: var(--color-text-muted, #6b7280);
  }

  .budget-card__limit {
    color: var(--color-text-muted, #6b7280);
  }

  .budget-card__remaining {
    margin-left: auto;
    font-weight: 500;
    color: var(--color-text-muted, #6b7280);
  }

  /* ── Month-over-month label ──────────────────────────────────────────────── */
  .mom {
    margin: 0;
    font-size: 0.8125rem;
  }

  .mom--up {
    color: var(--color-danger, #dc2626);
  }

  .mom--down {
    color: var(--color-success, #16a34a);
  }

  .mom--neutral {
    color: var(--color-text-muted, #6b7280);
  }

  /* ── Dialog backdrop (native modal via showModal()) ─────────────────────── */
  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }

  /* ── Dialog ──────────────────────────────────────────────────────────────── */
  .dialog {
    position: fixed;
    inset: 0;
    margin: auto;
    width: min(95vw, 28rem);
    height: fit-content;
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-xl, 1rem);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    padding: 0;
  }

  .dialog--sm {
    width: min(95vw, 22rem);
  }

  .dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-5, 1.25rem) var(--space-5, 1.25rem) 0;
  }

  .dialog__title {
    font-size: 1.125rem;
    font-weight: 700;
    margin: 0;
    color: var(--color-text, #111827);
  }

  .dialog__body {
    padding: var(--space-5, 1.25rem);
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 1rem);
  }

  .dialog__text {
    color: var(--color-text, #111827);
    margin: 0;
    line-height: 1.6;
  }

  .dialog__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-4, 1rem) var(--space-5, 1.25rem) var(--space-5, 1.25rem);
  }

  /* ── Form fields ─────────────────────────────────────────────────────────── */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }

  .field__label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text, #111827);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .field__hint {
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--color-text-muted, #6b7280);
  }

  .field__input,
  .field__select {
    width: 100%;
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    font-size: 0.9375rem;
    border: 1px solid var(--color-border, #d1d5db);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-surface, #ffffff);
    color: var(--color-text, #111827);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    box-sizing: border-box;
  }

  .field__input:focus,
  .field__select:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }

  .field__input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: var(--color-surface-2, #f3f4f6);
  }

  .field__prefix-wrap,
  .field__suffix-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .field__prefix {
    position: absolute;
    left: var(--space-3, 0.75rem);
    color: var(--color-text-muted, #6b7280);
    pointer-events: none;
    font-size: 0.9375rem;
  }

  .field__suffix {
    position: absolute;
    right: var(--space-3, 0.75rem);
    color: var(--color-text-muted, #6b7280);
    pointer-events: none;
    font-size: 0.9375rem;
  }

  .field__input--prefixed {
    padding-left: var(--space-6, 1.5rem);
  }

  .field__input--suffixed {
    padding-right: var(--space-6, 1.5rem);
  }

  .form-error {
    font-size: 0.875rem;
    color: var(--color-danger, #dc2626);
    background: var(--color-danger-subtle, #fef2f2);
    border: 1px solid var(--color-danger-border, #fecaca);
    border-radius: var(--radius-md, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    margin: 0;
  }

  /* ── Buttons ─────────────────────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    font-size: 0.9375rem;
    font-weight: 500;
    border-radius: var(--radius-md, 0.5rem);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn--primary {
    background: var(--color-primary, #6366f1);
    color: #ffffff;
    border-color: var(--color-primary, #6366f1);
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--color-primary-hover, #4f46e5);
    border-color: var(--color-primary-hover, #4f46e5);
  }

  .btn--ghost {
    background: transparent;
    color: var(--color-text, #111827);
    border-color: var(--color-border, #d1d5db);
  }

  .btn--ghost:hover:not(:disabled) {
    background: var(--color-surface-2, #f3f4f6);
  }

  .btn--danger {
    background: var(--color-danger, #dc2626);
    color: #ffffff;
    border-color: var(--color-danger, #dc2626);
  }

  .btn--danger:hover:not(:disabled) {
    background: var(--color-danger-hover, #b91c1c);
    border-color: var(--color-danger-hover, #b91c1c);
  }

  .btn--ghost.btn--danger {
    background: transparent;
    color: var(--color-danger, #dc2626);
    border-color: transparent;
  }

  .btn--ghost.btn--danger:hover:not(:disabled) {
    background: var(--color-danger-subtle, #fef2f2);
  }

  .btn--sm {
    padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
    font-size: 0.8125rem;
  }

  .btn--lg {
    padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem);
    font-size: 1rem;
  }

  .btn--icon {
    padding: var(--space-1, 0.25rem);
    border: none;
    font-size: 1rem;
    line-height: 1;
  }
</style>
