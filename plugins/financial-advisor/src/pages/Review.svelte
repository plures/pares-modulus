<script lang="ts">
  import { onMount } from 'svelte';
  import { getPluginContext } from '../lib/context.js';
  import {
    FA_TRANSACTIONS_COLLECTION,
    FA_INFERENCES_COLLECTION,
    confidenceLevel,

    type Transaction,
    type TransactionInference,
  } from '../lib/transactions.js';

  // ── Well-known categories ─────────────────────────────────────────────────
  const CATEGORIES = [
    'Food & Dining',
    'Groceries',
    'Shopping',
    'Entertainment',
    'Travel',
    'Transportation',
    'Utilities',
    'Healthcare',
    'Insurance',
    'Housing',
    'Subscriptions',
    'Education',
    'Income',
    'Transfer',
    'Refund',
    'Other',
  ] as const;

  // ── Rule strategy labels ──────────────────────────────────────────────────
  const RULE_STRATEGIES = [
    { id: 'fa-recurring-amount', label: 'Recurring Amount' },
    { id: 'fa-vendor-clustering', label: 'Vendor Clustering' },
    { id: 'fa-refund-detection', label: 'Refund Detection' },
    { id: 'fa-tax-variance', label: 'Tax Variance' },
  ] as const;

  let ctx: ReturnType<typeof getPluginContext>;
  let txCollection: ReturnType<NonNullable<typeof ctx>['data']['collection']> | undefined;
  let infCollection: ReturnType<NonNullable<typeof ctx>['data']['collection']> | undefined;

  // ── Raw data ──────────────────────────────────────────────────────────────
  let allTransactions = $state<Transaction[]>([]);
  let allInferences = $state<TransactionInference[]>([]);
  let loading = $state(true);

  // ── Filter state ──────────────────────────────────────────────────────────
  let filterStrategy = $state('');

  // ── Selection state ───────────────────────────────────────────────────────
  let selectedIds = $state<Set<string>>(new Set());

  // ── Batch confirm state ───────────────────────────────────────────────────
  let batchConfirming = $state(false);

  // ── Expanded row / decision chain ─────────────────────────────────────────
  let expandedId = $state<string | null>(null);
  let decisionChain = $state<unknown[]>([]);
  let loadingChain = $state(false);

  // ── Reject (category override) dialog ────────────────────────────────────
  let rejectInference = $state<TransactionInference | null>(null);
  let rejectTransaction = $state<Transaction | null>(null);
  let rejectCategory = $state('');
  let rejectSaving = $state(false);
  let rejectError = $state('');


  // ── Derived: transaction map keyed by id ─────────────────────────────────
  const transactionMap = $derived(new Map(allTransactions.map(tx => [tx.id, tx])));

  // ── Derived: unconfirmed inferences, sorted by confidence asc ────────────
  const unconfirmedRows = $derived(
    (() => {
      let rows = allInferences
        .filter(inf => inf.field === 'category' && !inf.userConfirmed)
        .map(inf => ({
          inf,
          tx: transactionMap.get(inf.transactionId) ?? null,
        }));

      // Filter by rule strategy
      if (filterStrategy) {
        rows = rows.filter(r => r.inf.sourceId === filterStrategy);
      }

      // Sort by confidence ascending (lowest first — most uncertain on top)
      rows.sort((a, b) => a.inf.confidence - b.inf.confidence);

      return rows;
    })(),
  );

  // ── Derived: statistics ───────────────────────────────────────────────────
  const stats = $derived(
    (() => {
      const categoryInferences = allInferences.filter(inf => inf.field === 'category');
      const total = categoryInferences.length;
      const unconfirmedTotal = categoryInferences.filter(inf => !inf.userConfirmed).length;
      const userConfirmed = categoryInferences.filter(
        inf => inf.userConfirmed && inf.sourceId !== 'user',
      ).length;
      const userRejected = categoryInferences.filter(
        inf => inf.userConfirmed && inf.sourceId === 'user',
      ).length;
      // auto-confirmed = confirmed but NOT by a direct user action or rejection
      const autoConfirmed = total - unconfirmedTotal - userConfirmed - userRejected;
      return {
        total,
        autoConfirmed: Math.max(0, autoConfirmed),
        userConfirmed,
        userRejected,
        pending: unconfirmedTotal,
      };
    })(),
  );

  // ── Derived: all visible rows selected ───────────────────────────────────
  const allSelected = $derived(
    unconfirmedRows.length > 0 && unconfirmedRows.every(r => selectedIds.has(r.inf.id)),
  );

  const someSelected = $derived(
    unconfirmedRows.some(r => selectedIds.has(r.inf.id)),
  );

  // ── Load on mount ─────────────────────────────────────────────────────────
  onMount(() => {
    ctx = getPluginContext();
    if (!ctx) return;
    txCollection = ctx.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION);
    infCollection = ctx.data.collection<TransactionInference>(FA_INFERENCES_COLLECTION);
    loadAll();
  });

  async function loadAll(): Promise<void> {
    loading = true;
    try {
      const [txs, infs] = await Promise.all([
        txCollection?.query() ?? Promise.resolve([]),
        infCollection?.query() ?? Promise.resolve([]),
      ]);
      allTransactions = txs as Transaction[];
      allInferences = infs as TransactionInference[];
    } catch {
      ctx?.notify.error('Failed to load data. Check your connection and try again.');
    } finally {
      loading = false;
    }
  }

  // ── Selection helpers ─────────────────────────────────────────────────────
  function toggleSelect(id: string): void {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds = next;
  }

  function toggleSelectAll(): void {
    if (allSelected) {
      selectedIds = new Set();
    } else {
      selectedIds = new Set(unconfirmedRows.map(r => r.inf.id));
    }
  }

  // ── Batch confirm ─────────────────────────────────────────────────────────
  async function batchConfirm(): Promise<void> {
    if (!infCollection || !ctx || selectedIds.size === 0) return;
    batchConfirming = true;
    const now = new Date().toISOString();
    const toConfirm = unconfirmedRows
      .filter(row => selectedIds.has(row.inf.id))
      .map(row => row.inf);
    try {
      await Promise.all(
        toConfirm.map(inf => {
          const updated = {
            ...inf,
            userConfirmed: true,
            updatedAt: now,
          } satisfies TransactionInference & Record<string, unknown>;
          return infCollection!.put(inf.id, updated).then(() => {
            allInferences = allInferences.map(i => (i.id === inf.id ? updated : i));
          });
        }),
      );
      ctx.notify.success(
        `Confirmed ${toConfirm.length} categorization${toConfirm.length === 1 ? '' : 's'}.`,
      );
      selectedIds = new Set();
    } catch {
      ctx.notify.error('Failed to confirm categorizations. Please try again.');
    } finally {
      batchConfirming = false;
    }
  }

  // ── Expand row / decision chain ───────────────────────────────────────────
  async function toggleExpand(infId: string): Promise<void> {
    if (expandedId === infId) {
      expandedId = null;
      decisionChain = [];
      loadingChain = false;
      return;
    }
    expandedId = infId;
    decisionChain = [];
    const requestedId = infId;

    if (!ctx) {
      loadingChain = false;
      return;
    }

    loadingChain = true;
    try {
      const chain = (await ctx.inference.getDecisionChain(infId)) ?? [];
      if (expandedId === requestedId) {
        decisionChain = chain;
      }
    } catch {
      if (expandedId === requestedId) {
        decisionChain = [{ note: 'Decision chain unavailable.' }];
      }
    } finally {
      if (expandedId === requestedId) {
        loadingChain = false;
      }
    }
  }

  // ── Reject (open override dialog) ─────────────────────────────────────────
  function openReject(inf: TransactionInference, tx: Transaction | null): void {
    rejectInference = inf;
    rejectTransaction = tx;
    rejectCategory = typeof inf.value === 'string' ? inf.value : '';
    rejectError = '';
  }

  function closeReject(): void {
    rejectInference = null;
    rejectTransaction = null;
    rejectError = '';
  }

  async function saveReject(): Promise<void> {
    if (!rejectInference || !infCollection || !ctx) return;
    if (!rejectCategory) {
      rejectError = 'Please select a category.';
      return;
    }
    rejectSaving = true;
    rejectError = '';
    try {
      const inf = rejectInference;
      const now = new Date().toISOString();
      const updated: TransactionInference = {
        ...inf,
        value: rejectCategory,
        confidence: 1.0,
        reasoning: 'Manually set by user.',
        sourceId: 'user',
        userConfirmed: true,
        updatedAt: now,
      };
      await infCollection.put(inf.id, updated as unknown as Record<string, unknown>);
      allInferences = allInferences.map(i => (i.id === inf.id ? updated : i));
      // Remove from selection if present
      if (selectedIds.has(inf.id)) {
        const next = new Set(selectedIds);
        next.delete(inf.id);
        selectedIds = next;
      }
      ctx.notify.success('Category corrected.');
      closeReject();
    } catch {
      rejectError = 'Failed to save category. Check your connection and try again.';
    } finally {
      rejectSaving = false;
    }
  }

  // ── Modal action ──────────────────────────────────────────────────────────
  function useModal(node: HTMLDialogElement, params: { onClose: () => void }) {
    function handleCancel(e: Event) {
      e.preventDefault();
      params.onClose();
    }
    function handleBackdropClick(e: MouseEvent) {
      if (e.target === node) params.onClose();
    }
    node.showModal();
    node.addEventListener('cancel', handleCancel);
    node.addEventListener('click', handleBackdropClick);
    return {
      destroy() {
        node.removeEventListener('cancel', handleCancel);
        node.removeEventListener('click', handleBackdropClick);
        if (node.open) node.close();
      },
    };
  }

  // ── Formatters ────────────────────────────────────────────────────────────
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }

  function formatDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(iso + 'T00:00:00Z'));
  }

  function formatConfidence(score: number): string {
    return `${Math.round(score * 100)}%`;
  }

  function ruleLabel(sourceId: string): string {
    return RULE_STRATEGIES.find(r => r.id === sourceId)?.label ?? sourceId;
  }
</script>

<!-- ── Page ──────────────────────────────────────────────────────────────── -->
<div class="review-page">
  <!-- Header -->
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">Review Categorizations</h1>
      {#if !loading}
        <p class="page-header__subtitle">
          {unconfirmedRows.length} pending review
          {#if filterStrategy}· filtered by {ruleLabel(filterStrategy)}{/if}
        </p>
      {/if}
    </div>
    {#if someSelected}
      <button
        class="btn btn--primary"
        onclick={() => batchConfirm().catch((err: unknown) => console.error('[review] batchConfirm:', err))}
        disabled={batchConfirming}
        aria-label="Confirm {selectedIds.size} selected categorization{selectedIds.size === 1 ? '' : 's'}"
      >
        {batchConfirming ? 'Confirming…' : `Confirm ${selectedIds.size} Selected`}
      </button>
    {/if}
  </header>

  <!-- Statistics bar -->
  {#if !loading}
    <section class="stats-bar" aria-label="Review statistics">
      <div class="stat">
        <span class="stat__value">{stats.total}</span>
        <span class="stat__label">Total</span>
      </div>
      <div class="stat">
        <span class="stat__value">{stats.pending}</span>
        <span class="stat__label">Pending</span>
      </div>
      <div class="stat stat--auto">
        <span class="stat__value">{stats.autoConfirmed}</span>
        <span class="stat__label">Auto-confirmed</span>
      </div>
      <div class="stat stat--confirmed">
        <span class="stat__value">{stats.userConfirmed}</span>
        <span class="stat__label">User-confirmed</span>
      </div>
      <div class="stat stat--rejected">
        <span class="stat__value">{stats.userRejected}</span>
        <span class="stat__label">User-corrected</span>
      </div>
    </section>
  {/if}

  <!-- Filter bar -->
  <section class="filter-bar" aria-label="Filter by rule strategy">
    <div class="filter-bar__row">
      <div class="filter-field">
        <label class="filter-field__label" for="filter-strategy">Rule Strategy</label>
        <select
          id="filter-strategy"
          class="field__select"
          bind:value={filterStrategy}
        >
          <option value="">All strategies</option>
          {#each RULE_STRATEGIES as rule}
            <option value={rule.id}>{rule.label}</option>
          {/each}
        </select>
      </div>
      {#if filterStrategy}
        <button
          class="btn btn--ghost btn--sm filter-clear"
          onclick={() => { filterStrategy = ''; }}
        >
          ✕ Clear
        </button>
      {/if}
    </div>
  </section>

  <!-- Loading skeleton -->
  {#if loading}
    <div class="skeleton-list" aria-busy="true" aria-label="Loading inferences">
      {#each [1, 2, 3, 4, 5] as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>

  <!-- All confirmed — nothing to review -->
  {:else if unconfirmedRows.length === 0}
    <div class="empty-state" role="region" aria-label="All reviewed">
      <span class="empty-state__icon" aria-hidden="true">✅</span>
      <h2 class="empty-state__heading">
        {filterStrategy ? 'No pending items for this strategy' : 'All caught up!'}
      </h2>
      <p class="empty-state__body">
        {#if filterStrategy}
          No unconfirmed categorizations for <strong>{ruleLabel(filterStrategy)}</strong>.
          Try another strategy or clear the filter.
        {:else}
          Every categorization has been reviewed. Import more transactions to continue.
        {/if}
      </p>
      {#if filterStrategy}
        <button class="btn btn--ghost" onclick={() => { filterStrategy = ''; }}>
          Clear filter
        </button>
      {/if}
    </div>

  <!-- Review list -->
  {:else}
    <div class="review-table" role="table" aria-label="Unconfirmed categorizations">
      <!-- Table header -->
      <div class="review-table__head" role="row">
        <div class="review-table__th review-table__th--check" role="columnheader">
          <input
            type="checkbox"
            class="checkbox"
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onchange={toggleSelectAll}
            aria-label="Select all"
          />
        </div>
        <span class="review-table__th review-table__th--date" role="columnheader">Date</span>
        <span class="review-table__th review-table__th--vendor" role="columnheader">
          Vendor / Description
        </span>
        <span class="review-table__th review-table__th--amount" role="columnheader">Amount</span>
        <span class="review-table__th review-table__th--category" role="columnheader">
          Suggested Category
        </span>
        <span class="review-table__th review-table__th--confidence" role="columnheader">
          Confidence
        </span>
        <span class="review-table__th review-table__th--rule" role="columnheader">Rule</span>
        <span class="review-table__th review-table__th--actions" role="columnheader">
          <span class="sr-only">Actions</span>
        </span>
      </div>

      <!-- Rows -->
      {#each unconfirmedRows as { inf, tx } (inf.id)}
        {@const level = confidenceLevel(inf.confidence)}
        {@const isExpanded = expandedId === inf.id}
        {@const isSelected = selectedIds.has(inf.id)}
        <div
          class="review-row"
          class:review-row--expanded={isExpanded}
          class:review-row--selected={isSelected}
          role="row"
          aria-selected={isSelected}
          aria-expanded={isExpanded}
        >
          <!-- Main row -->
          <div class="review-row__main">
            <!-- Checkbox -->
            <span class="review-row__check" role="cell">
              <input
                type="checkbox"
                class="checkbox"
                checked={isSelected}
                onchange={() => toggleSelect(inf.id)}
                aria-label="Select {tx?.description ?? inf.transactionId}"
              />
            </span>

            <!-- Date -->
            <span class="review-row__date" role="cell">
              {tx ? formatDate(tx.date) : '—'}
            </span>

            <!-- Vendor -->
            <span class="review-row__vendor" role="cell" title={tx?.description}>
              {tx?.description ?? inf.transactionId}
            </span>

            <!-- Amount -->
            <span
              class="review-row__amount"
              class:review-row__amount--credit={tx && tx.amount > 0}
              class:review-row__amount--debit={tx && tx.amount < 0}
              role="cell"
            >
              {tx ? formatCurrency(tx.amount) : '—'}
            </span>

            <!-- Suggested category -->
            <span class="review-row__category" role="cell">
              <span class="category-tag">
                {typeof inf.value === 'string' ? inf.value : '—'}
              </span>
            </span>

            <!-- Confidence -->
            <span class="review-row__confidence" role="cell">
              <span
                class="confidence-badge confidence-badge--{level}"
                aria-label="Confidence: {formatConfidence(inf.confidence)}"
              >
                {formatConfidence(inf.confidence)}
              </span>
            </span>

            <!-- Rule -->
            <span class="review-row__rule" role="cell">
              <span class="rule-tag">{ruleLabel(inf.sourceId)}</span>
            </span>

            <!-- Actions -->
            <span class="review-row__actions" role="cell">
              <button
                class="btn btn--ghost btn--sm"
                onclick={() => openReject(inf, tx)}
                aria-label="Reject and correct category for {tx?.description ?? inf.transactionId}"
              >
                Reject
              </button>
              <button
                class="btn btn--ghost btn--sm btn--icon-only"
                onclick={() => toggleExpand(inf.id).catch((err: unknown) => console.error('[review] toggleExpand:', err))}
                aria-label="{isExpanded ? 'Collapse' : 'Expand'} decision chain for {tx?.description ?? inf.transactionId}"
                aria-expanded={isExpanded}
              >
                {isExpanded ? '▲' : '▼'}
              </button>
            </span>
          </div>

          <!-- Expanded decision chain -->
          {#if isExpanded}
            <div class="review-row__detail" role="region" aria-label="Decision chain">
              {#if loadingChain}
                <p class="detail__loading">Loading decision chain…</p>
              {:else if decisionChain.length === 0}
                <p class="detail__empty">No decision chain available for this inference.</p>
              {:else}
                <ol class="decision-chain" aria-label="Inference decision chain">
                  {#each decisionChain as step, i}
                    <li class="decision-chain__step">
                      <span class="decision-chain__step-num">{i + 1}</span>
                      <pre class="decision-chain__content">{JSON.stringify(step, null, 2)}</pre>
                    </li>
                  {/each}
                </ol>
              {/if}
              <dl class="detail__meta">
                <div>
                  <dt>Reasoning</dt>
                  <dd>{inf.reasoning}</dd>
                </div>
                <div>
                  <dt>Rule</dt>
                  <dd>{ruleLabel(inf.sourceId)}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{formatConfidence(inf.confidence)}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{inf.updatedAt}</dd>
                </div>
              </dl>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ── Reject / override dialog ───────────────────────────────────────────── -->
{#if rejectInference !== null}
  <dialog
    use:useModal={{ onClose: closeReject }}
    class="dialog"
    aria-modal="true"
    aria-labelledby="reject-dialog-title"
  >
    <header class="dialog__header">
      <h2 class="dialog__title" id="reject-dialog-title">Correct Category</h2>
      <button
        class="btn btn--ghost btn--icon"
        onclick={closeReject}
        aria-label="Close dialog"
      >
        ✕
      </button>
    </header>

    <form
      class="dialog__body"
      onsubmit={(e) => {
        e.preventDefault();
        saveReject().catch((err: unknown) => console.error('[review] saveReject:', err));
      }}
      novalidate
    >
      {#if rejectTransaction}
        <p class="dialog__desc">
          <strong>{rejectTransaction.description}</strong><br />
          {formatDate(rejectTransaction.date)} · {formatCurrency(rejectTransaction.amount)}
        </p>
      {/if}

      <p class="dialog__suggestion">
        Suggested: <span class="category-tag">{typeof rejectInference.value === 'string' ? rejectInference.value : '—'}</span>
        <span class="confidence-badge confidence-badge--{confidenceLevel(rejectInference.confidence)}">
          {formatConfidence(rejectInference.confidence)}
        </span>
      </p>

      {#if rejectError}
        <p class="form-error" role="alert">{rejectError}</p>
      {/if}

      <div class="field">
        <label class="field__label" for="reject-category">
          Correct Category <span aria-hidden="true">*</span>
        </label>
        <select
          id="reject-category"
          class="field__select"
          bind:value={rejectCategory}
          required
        >
          <option value="">— Select a category —</option>
          {#each CATEGORIES as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
      </div>

      <footer class="dialog__footer">
        <button
          class="btn btn--ghost"
          type="button"
          onclick={closeReject}
          disabled={rejectSaving}
        >
          Cancel
        </button>
        <button class="btn btn--primary" type="submit" disabled={rejectSaving}>
          {rejectSaving ? 'Saving…' : 'Save Correction'}
        </button>
      </footer>
    </form>
  </dialog>
{/if}

<style>
  /* ── Layout ──────────────────────────────────────────────────────────────── */
  .review-page {
    padding: var(--space-6, 1.5rem);
    max-width: 72rem;
    margin: 0 auto;
  }

  /* ── Page header ─────────────────────────────────────────────────────────── */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4, 1rem);
    margin-bottom: var(--space-4, 1rem);
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

  /* ── Statistics bar ──────────────────────────────────────────────────────── */
  .stats-bar {
    display: flex;
    gap: var(--space-4, 1rem);
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    padding: var(--space-4, 1rem) var(--space-6, 1.5rem);
    margin-bottom: var(--space-5, 1.25rem);
    flex-wrap: wrap;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    flex: 1;
    min-width: 5rem;
  }

  .stat__value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-text, #111827);
    line-height: 1;
  }

  .stat__label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-align: center;
  }

  .stat--auto .stat__value {
    color: var(--color-info, #3b82f6);
  }

  .stat--confirmed .stat__value {
    color: var(--color-success, #16a34a);
  }

  .stat--rejected .stat__value {
    color: var(--color-warning, #d97706);
  }

  /* ── Filter bar ──────────────────────────────────────────────────────────── */
  .filter-bar {
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    padding: var(--space-4, 1rem);
    margin-bottom: var(--space-5, 1.25rem);
  }

  .filter-bar__row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3, 0.75rem);
    align-items: flex-end;
  }

  .filter-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
    min-width: 12rem;
    flex: 1;
    max-width: 20rem;
  }

  .filter-field__label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .filter-clear {
    align-self: flex-end;
    flex-shrink: 0;
  }

  /* ── Skeleton ────────────────────────────────────────────────────────────── */
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
  }

  .skeleton-row {
    height: 3.5rem;
    border-radius: var(--radius-md, 0.5rem);
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

  /* ── Review table ────────────────────────────────────────────────────────── */
  .review-table {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    overflow: hidden;
    background: var(--color-surface, #ffffff);
  }

  .review-table__head {
    display: grid;
    grid-template-columns: 2.5rem 7rem 1fr 7rem 9rem 6.5rem 10rem 9rem;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    background: var(--color-surface-2, #f3f4f6);
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }

  .review-table__th {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
  }

  /* ── Review rows ─────────────────────────────────────────────────────────── */
  .review-row {
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }

  .review-row:last-child {
    border-bottom: none;
  }

  .review-row__main {
    display: grid;
    grid-template-columns: 2.5rem 7rem 1fr 7rem 9rem 6.5rem 10rem 9rem;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    align-items: center;
    transition: background 0.1s ease;
  }

  .review-row:hover .review-row__main {
    background: var(--color-surface-2, #f9fafb);
  }

  .review-row--expanded .review-row__main,
  .review-row--selected .review-row__main {
    background: var(--color-surface-2, #f9fafb);
  }

  .review-row--selected .review-row__main {
    background: color-mix(in srgb, var(--color-primary, #4f46e5) 6%, transparent);
  }

  .review-row__date {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
  }

  .review-row__vendor {
    font-size: 0.875rem;
    color: var(--color-text, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .review-row__amount {
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-align: right;
  }

  .review-row__amount--credit {
    color: var(--color-success, #16a34a);
  }

  .review-row__amount--debit {
    color: var(--color-text, #111827);
  }

  .review-row__category {
    display: flex;
    align-items: center;
  }

  .review-row__confidence {
    display: flex;
    align-items: center;
  }

  .review-row__rule {
    display: flex;
    align-items: center;
  }

  .review-row__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
  }

  /* ── Expanded decision chain ─────────────────────────────────────────────── */
  .review-row__detail {
    padding: var(--space-4, 1rem) var(--space-6, 1.5rem);
    background: var(--color-surface-2, #f9fafb);
    border-top: 1px solid var(--color-border, #e5e7eb);
  }

  .detail__loading,
  .detail__empty {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0 0 var(--space-3, 0.75rem);
  }

  .decision-chain {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-4, 1rem);
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
  }

  .decision-chain__step {
    display: flex;
    gap: var(--space-3, 0.75rem);
    align-items: flex-start;
  }

  .decision-chain__step-num {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: var(--color-primary, #4f46e5);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .decision-chain__content {
    font-size: 0.75rem;
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-sm, 0.25rem);
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    margin: 0;
    flex: 1;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .detail__meta {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-2, 0.5rem) var(--space-6, 1.5rem);
    font-size: 0.8125rem;
    margin: 0;
  }

  .detail__meta > div {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .detail__meta dt {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted, #6b7280);
  }

  .detail__meta dd {
    margin: 0;
    color: var(--color-text, #111827);
  }

  /* ── Category tag ────────────────────────────────────────────────────────── */
  .category-tag {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-surface-2, #f3f4f6);
    border: 1px solid var(--color-border, #e5e7eb);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text, #111827);
    white-space: nowrap;
  }

  /* ── Rule tag ────────────────────────────────────────────────────────────── */
  .rule-tag {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-full, 9999px);
    background: color-mix(in srgb, var(--color-primary, #4f46e5) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary, #4f46e5) 20%, transparent);
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-primary, #4f46e5);
    white-space: nowrap;
  }

  /* ── Confidence badge ────────────────────────────────────────────────────── */
  .confidence-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.375rem;
    border-radius: var(--radius-sm, 0.25rem);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .confidence-badge--high {
    background: color-mix(in srgb, var(--color-success, #16a34a) 12%, transparent);
    color: var(--color-success, #16a34a);
  }

  .confidence-badge--medium {
    background: color-mix(in srgb, var(--color-warning, #d97706) 12%, transparent);
    color: var(--color-warning, #d97706);
  }

  .confidence-badge--low {
    background: color-mix(in srgb, var(--color-error, #dc2626) 12%, transparent);
    color: var(--color-error, #dc2626);
  }

  /* ── Checkbox ────────────────────────────────────────────────────────────── */
  .checkbox {
    width: 1rem;
    height: 1rem;
    cursor: pointer;
    accent-color: var(--color-primary, #4f46e5);
  }

  /* ── Field controls ──────────────────────────────────────────────────────── */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }

  .field__label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text, #111827);
  }

  .field__select {
    height: 2.25rem;
    padding: 0 var(--space-3, 0.75rem);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-surface, #ffffff);
    font-size: 0.875rem;
    color: var(--color-text, #111827);
    appearance: auto;
  }

  .field__select:focus {
    outline: 2px solid var(--color-primary, #4f46e5);
    outline-offset: 1px;
  }

  /* ── Buttons ─────────────────────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 0.5rem);
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md, 0.5rem);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
    text-decoration: none;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn--primary {
    background: var(--color-primary, #4f46e5);
    color: #fff;
    border-color: var(--color-primary, #4f46e5);
  }

  .btn--primary:not(:disabled):hover {
    background: color-mix(in srgb, var(--color-primary, #4f46e5) 85%, #000);
  }

  .btn--ghost {
    background: transparent;
    color: var(--color-text, #111827);
    border-color: var(--color-border, #e5e7eb);
  }

  .btn--ghost:not(:disabled):hover {
    background: var(--color-surface-2, #f3f4f6);
  }

  .btn--sm {
    padding: 0.25rem 0.625rem;
    font-size: 0.8125rem;
  }

  .btn--icon,
  .btn--icon-only {
    padding: 0.375rem;
    line-height: 1;
  }

  /* ── Dialog ──────────────────────────────────────────────────────────────── */
  .dialog {
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-xl, 1rem);
    padding: 0;
    max-width: 28rem;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }

  .dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4, 1rem) var(--space-5, 1.25rem);
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }

  .dialog__title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0;
    color: var(--color-text, #111827);
  }

  .dialog__body {
    padding: var(--space-5, 1.25rem);
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 1rem);
  }

  .dialog__desc {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0;
    line-height: 1.5;
  }

  .dialog__suggestion {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0;
  }

  .dialog__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3, 0.75rem);
  }

  /* ── Form error ──────────────────────────────────────────────────────────── */
  .form-error {
    font-size: 0.875rem;
    color: var(--color-error, #dc2626);
    margin: 0;
  }

  /* ── Accessibility ───────────────────────────────────────────────────────── */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
