<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Input, Select, Dialog } from '@plures/design-dojo';
  import { getPluginContext } from '../lib/context.js';
  import {
    FA_TRANSACTIONS_COLLECTION,
    FA_INFERENCES_COLLECTION,
    confidenceLevel,
    generateInferenceId,
    type Transaction,
    type TransactionInference,
  } from '../lib/transactions.js';
  import {
    FA_ACCOUNTS_COLLECTION,
    type Account,
  } from '../lib/accounts.js';
  import { TRANSACTION_CATEGORIES as CATEGORIES } from '../lib/categories.js';

  type SortField = 'date' | 'amount' | 'confidence';
  type SortDir = 'asc' | 'desc';

  let ctx: ReturnType<typeof getPluginContext>;
  let txCollection: ReturnType<NonNullable<typeof ctx>['data']['collection']> | undefined;
  let infCollection: ReturnType<NonNullable<typeof ctx>['data']['collection']> | undefined;
  let acctCollection: ReturnType<NonNullable<typeof ctx>['data']['collection']> | undefined;

  // ── Raw data ──────────────────────────────────────────────────────────────
  let allTransactions = $state<Transaction[]>([]);
  let allInferences = $state<TransactionInference[]>([]);
  let accounts = $state<Account[]>([]);
  let loading = $state(true);

  // ── Filter state ──────────────────────────────────────────────────────────
  let filterAccountId = $state('');
  let filterDateFrom = $state('');
  let filterDateTo = $state('');
  let filterCategory = $state('');
  let filterAmountMin = $state('');
  let filterAmountMax = $state('');

  // ── Sort state ────────────────────────────────────────────────────────────
  let sortField = $state<SortField>('date');
  let sortDir = $state<SortDir>('desc');

  // ── Expanded row ─────────────────────────────────────────────────────────
  let expandedId = $state<string | null>(null);
  let decisionChain = $state<unknown[]>([]);
  let loadingChain = $state(false);

  // ── Category override dialog ──────────────────────────────────────────────
  let overrideTransaction = $state<Transaction | null>(null);
  let overrideCategory = $state('');
  let overrideSaving = $state(false);
  let overrideError = $state('');

  // ── Derived: inference map keyed by transactionId ────────────────────────
  const inferenceMap = $derived(
    new Map<string, TransactionInference>(
      allInferences
        .filter(inf => inf.field === 'category')
        .map(inf => [inf.transactionId, inf]),
    ),
  );

  // ── Derived: filtered + sorted rows ──────────────────────────────────────
  const filteredRows = $derived(
    (() => {
      let rows = allTransactions.map(tx => ({
        tx,
        inference: inferenceMap.get(tx.id) ?? null,
      }));

      // Account filter
      if (filterAccountId) {
        rows = rows.filter(r => r.tx.accountId === filterAccountId);
      }

      // Date range filter
      if (filterDateFrom) {
        rows = rows.filter(r => r.tx.date >= filterDateFrom);
      }
      if (filterDateTo) {
        rows = rows.filter(r => r.tx.date <= filterDateTo);
      }

      // Category filter
      if (filterCategory) {
        rows = rows.filter(r => {
          const cat = r.inference?.value ?? '';
          return typeof cat === 'string' && cat === filterCategory;
        });
      }

      // Amount range filter
      const minAmt = parseFloat(filterAmountMin);
      const maxAmt = parseFloat(filterAmountMax);
      if (!isNaN(minAmt)) {
        rows = rows.filter(r => r.tx.amount >= minAmt);
      }
      if (!isNaN(maxAmt)) {
        rows = rows.filter(r => r.tx.amount <= maxAmt);
      }

      // Sort
      rows.sort((a, b) => {
        let diff = 0;
        if (sortField === 'date') {
          diff = a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : 0;
        } else if (sortField === 'amount') {
          diff = a.tx.amount - b.tx.amount;
        } else {
          const ca = a.inference?.confidence ?? -1;
          const cb = b.inference?.confidence ?? -1;
          diff = ca - cb;
        }
        return sortDir === 'asc' ? diff : -diff;
      });

      return rows;
    })(),
  );

  const accountMap = $derived(new Map(accounts.map(a => [a.id, a])));

  // ── Load on mount ─────────────────────────────────────────────────────────
  onMount(() => {
    ctx = getPluginContext();
    if (!ctx) return;
    txCollection = ctx.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION);
    infCollection = ctx.data.collection<TransactionInference>(FA_INFERENCES_COLLECTION);
    acctCollection = ctx.data.collection<Account>(FA_ACCOUNTS_COLLECTION);
    loadAll();
  });

  async function loadAll(): Promise<void> {
    loading = true;
    try {
      const [txs, infs, accts] = await Promise.all([
        txCollection?.query() ?? Promise.resolve([]),
        infCollection?.query() ?? Promise.resolve([]),
        acctCollection?.query() ?? Promise.resolve([]),
      ]);
      allTransactions = txs as Transaction[];
      allInferences = infs as TransactionInference[];
      accounts = accts as Account[];
    } catch {
      ctx?.notify.error('Failed to load transactions.');
    } finally {
      loading = false;
    }
  }

  // ── Sort helpers ──────────────────────────────────────────────────────────
  function toggleSort(field: SortField): void {
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = 'desc';
    }
  }

  function sortIcon(field: SortField): string {
    if (sortField !== field) return '↕';
    return sortDir === 'asc' ? '↑' : '↓';
  }

  // ── Expand row / decision chain ───────────────────────────────────────────
  async function toggleExpand(id: string): Promise<void> {
    if (expandedId === id) {
      expandedId = null;
      decisionChain = [];
      loadingChain = false;
      return;
    }
    expandedId = id;
    decisionChain = [];
    const requestedId = id;

    const inf = inferenceMap.get(id);
    if (!inf || !ctx) {
      loadingChain = false;
      return;
    }

    loadingChain = true;
    try {
      const chain = (await ctx.inference.getDecisionChain(inf.id)) ?? [];
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

  // ── Category override ─────────────────────────────────────────────────────
  function openOverride(tx: Transaction): void {
    overrideTransaction = tx;
    const existing = inferenceMap.get(tx.id);
    overrideCategory =
      typeof existing?.value === 'string' ? existing.value : '';
    overrideError = '';
  }

  function closeOverride(): void {
    overrideTransaction = null;
    overrideError = '';
  }

  async function saveOverride(): Promise<void> {
    if (!overrideTransaction || !infCollection || !ctx) return;

    if (!overrideCategory) {
      overrideError = 'Please select a category.';
      return;
    }

    overrideSaving = true;
    overrideError = '';
    try {
      const tx = overrideTransaction;
      const id = generateInferenceId(tx.id, 'category');
      const existing = inferenceMap.get(tx.id);
      const now = new Date().toISOString();
      const record: TransactionInference = {
        // Carry over any existing immutable fields (e.g. first seen)
        ...(existing ?? {}),
        // Always-set fields
        id,
        transactionId: tx.id,
        field: 'category',
        // User override fields
        value: overrideCategory,
        confidence: 1.0,
        reasoning: 'Manually set by user.',
        sourceId: 'user',
        userConfirmed: true,
        updatedAt: now,
      };
      await infCollection.put(id, record as unknown as Record<string, unknown>);
      // Update local state
      if (allInferences.some(i => i.id === id)) {
        allInferences = allInferences.map(i => (i.id === id ? record : i));
      } else {
        allInferences = [...allInferences, record];
      }
      ctx.notify.success('Category updated.');
      closeOverride();
    } catch {
      overrideError = 'Failed to save category. Please try again.';
    } finally {
      overrideSaving = false;
    }
  }


  // ── Formatters ────────────────────────────────────────────────────────────
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
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

  function clearFilters(): void {
    filterAccountId = '';
    filterDateFrom = '';
    filterDateTo = '';
    filterCategory = '';
    filterAmountMin = '';
    filterAmountMax = '';
  }

  const hasFilters = $derived(
    Boolean(filterAccountId || filterDateFrom || filterDateTo || filterCategory || filterAmountMin || filterAmountMax),
  );
</script>

<!-- ── Page ──────────────────────────────────────────────────────────────── -->
<div class="transactions-page">
  <!-- Header -->
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">Transactions</h1>
      {#if !loading}
        <p class="page-header__subtitle">
          {filteredRows.length} of {allTransactions.length} transaction{allTransactions.length === 1 ? '' : 's'}
        </p>
      {/if}
    </div>
  </header>

  <!-- Filter bar -->
  <section class="filter-bar" aria-label="Filter transactions">
    <div class="filter-bar__row">
      <!-- Account -->
      <div class="filter-field">
        <label class="filter-field__label" for="filter-account">Account</label>
        <Select
          id="filter-account"
          class="field__select"
          bind:value={filterAccountId}
        >
          <option value="">All accounts</option>
          {#each accounts as acct (acct.id)}
            <option value={acct.id}>{acct.name}</option>
          {/each}
        </Select>
      </div>

      <!-- Date from -->
      <div class="filter-field">
        <label class="filter-field__label" for="filter-date-from">From</label>
        <Input
          id="filter-date-from"
          class="field__input"
          type="date"
          bind:value={filterDateFrom}
        />
      </div>

      <!-- Date to -->
      <div class="filter-field">
        <label class="filter-field__label" for="filter-date-to">To</label>
        <Input
          id="filter-date-to"
          class="field__input"
          type="date"
          bind:value={filterDateTo}
        />
      </div>

      <!-- Category -->
      <div class="filter-field">
        <label class="filter-field__label" for="filter-category">Category</label>
        <Select
          id="filter-category"
          class="field__select"
          bind:value={filterCategory}
        >
          <option value="">All categories</option>
          {#each CATEGORIES as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </Select>
      </div>

      <!-- Amount min -->
      <div class="filter-field filter-field--sm">
        <label class="filter-field__label" for="filter-amt-min">Min $</label>
        <Input
          id="filter-amt-min"
          class="field__input"
          type="number"
          step="0.01"
          placeholder="0.00"
          bind:value={filterAmountMin}
        />
      </div>

      <!-- Amount max -->
      <div class="filter-field filter-field--sm">
        <label class="filter-field__label" for="filter-amt-max">Max $</label>
        <Input
          id="filter-amt-max"
          class="field__input"
          type="number"
          step="0.01"
          placeholder="∞"
          bind:value={filterAmountMax}
        />
      </div>

      {#if hasFilters}
        <Button class="btn btn--ghost btn--sm filter-clear" onclick={clearFilters}>
          ✕ Clear
        </Button>
      {/if}
    </div>
  </section>

  <!-- Loading skeleton -->
  {#if loading}
    <div class="skeleton-list" aria-busy="true" aria-label="Loading transactions">
      {#each [1, 2, 3, 4, 5] as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>

  <!-- Empty state — no transactions at all -->
  {:else if allTransactions.length === 0}
    <div class="empty-state" role="region" aria-label="No transactions">
      <span class="empty-state__icon" aria-hidden="true">💳</span>
      <h2 class="empty-state__heading">No transactions yet</h2>
      <p class="empty-state__body">
        Import bank statements to start tracking and categorizing your transactions.
      </p>
    </div>

  <!-- Empty state — filter produced no results -->
  {:else if filteredRows.length === 0}
    <div class="empty-state" role="region" aria-label="No matching transactions">
      <span class="empty-state__icon" aria-hidden="true">🔍</span>
      <h2 class="empty-state__heading">No matching transactions</h2>
      <p class="empty-state__body">Try adjusting your filters.</p>
      <Button class="btn btn--ghost" onclick={clearFilters}>Clear filters</Button>
    </div>

  <!-- Transaction list -->
  {:else}
    <div class="tx-table" role="table" aria-label="Transactions">
      <!-- Table header -->
      <div class="tx-table__head" role="row">
        <Button
          class="tx-table__th tx-table__th--date"
          role="columnheader"
          aria-sort={sortField === 'date' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
          onclick={() => toggleSort('date')}
        >
          Date <span class="sort-icon" aria-hidden="true">{sortIcon('date')}</span>
        </Button>
        <span class="tx-table__th tx-table__th--vendor" role="columnheader">Vendor / Description</span>
        <Button
          class="tx-table__th tx-table__th--amount"
          role="columnheader"
          aria-sort={sortField === 'amount' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
          onclick={() => toggleSort('amount')}
        >
          Amount <span class="sort-icon" aria-hidden="true">{sortIcon('amount')}</span>
        </Button>
        <span class="tx-table__th tx-table__th--account" role="columnheader">Account</span>
        <span class="tx-table__th tx-table__th--category" role="columnheader">Category</span>
        <Button
          class="tx-table__th tx-table__th--confidence"
          role="columnheader"
          aria-sort={sortField === 'confidence' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
          onclick={() => toggleSort('confidence')}
        >
          Confidence <span class="sort-icon" aria-hidden="true">{sortIcon('confidence')}</span>
        </Button>
        <span class="tx-table__th tx-table__th--actions" role="columnheader">
          <span class="sr-only">Actions</span>
        </span>
      </div>

      <!-- Rows -->
      {#each filteredRows as { tx, inference } (tx.id)}
        {@const level = inference ? confidenceLevel(inference.confidence) : null}
        {@const isExpanded = expandedId === tx.id}
        <div
          class="tx-row"
          class:tx-row--expanded={isExpanded}
          role="row"
          aria-expanded={isExpanded}
        >
          <!-- Main row -->
          <div class="tx-row__main">
            <span class="tx-row__date" role="cell">{formatDate(tx.date)}</span>
            <span class="tx-row__vendor" role="cell" title={tx.description}>
              {tx.description}
            </span>
            <span
              class="tx-row__amount"
              class:tx-row__amount--credit={tx.amount > 0}
              class:tx-row__amount--debit={tx.amount < 0}
              role="cell"
            >
              {formatCurrency(tx.amount)}
            </span>
            <span class="tx-row__account" role="cell">
              {accountMap.get(tx.accountId)?.name ?? '—'}
            </span>
            <span class="tx-row__category" role="cell">
              {#if inference}
                <span class="category-tag">
                  {inference.userConfirmed
                    ? '✓ '
                    : ''}{typeof inference.value === 'string' ? inference.value : '—'}
                </span>
              {:else}
                <span class="category-tag category-tag--none">Uncategorized</span>
              {/if}
            </span>
            <span class="tx-row__confidence" role="cell">
              {#if inference}
                <span
                  class="confidence-badge confidence-badge--{level}"
                  aria-label="Confidence: {formatConfidence(inference.confidence)}"
                >
                  {formatConfidence(inference.confidence)}
                </span>
              {:else}
                <span class="confidence-badge confidence-badge--none">—</span>
              {/if}
            </span>
            <span class="tx-row__actions" role="cell">
              <Button
                class="btn btn--ghost btn--sm"
                onclick={() => openOverride(tx)}
                aria-label="Set category for {tx.description}"
              >
                Categorize
              </Button>
              <Button
                class="btn btn--ghost btn--sm btn--icon-only"
                onclick={() => toggleExpand(tx.id).catch(() => {})}
                aria-label="{isExpanded ? 'Collapse' : 'Expand'} details for {tx.description}"
                aria-expanded={isExpanded}
              >
                {isExpanded ? '▲' : '▼'}
              </Button>
            </span>
          </div>

          <!-- Expanded decision chain -->
          {#if isExpanded}
            <div class="tx-row__detail" role="region" aria-label="Decision chain">
              {#if loadingChain}
                <p class="tx-detail__loading">Loading decision chain…</p>
              {:else if decisionChain.length === 0}
                <p class="tx-detail__empty">
                  {inference
                    ? inference.userConfirmed
                      ? 'Manually categorized by user.'
                      : 'No decision chain available for this inference.'
                    : 'This transaction has not been categorized yet.'}
                </p>
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
              {#if inference}
                <dl class="tx-detail__meta">
                  <div>
                    <dt>Reasoning</dt>
                    <dd>{inference.reasoning}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{inference.sourceId}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{formatConfidence(inference.confidence)}</dd>
                  </div>
                  <div>
                    <dt>User confirmed</dt>
                    <dd>{inference.userConfirmed ? 'Yes' : 'No'}</dd>
                  </div>
                </dl>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ── Category override dialog ───────────────────────────────────────────── -->
{#if overrideTransaction !== null}
  <Dialog
    onclose={closeOverride}
    class="dialog"
    aria-labelledby="override-dialog-title"
  >
    <header class="dialog__header">
      <h2 class="dialog__title" id="override-dialog-title">Set Category</h2>
      <Button
        class="btn btn--ghost btn--icon"
        onclick={closeOverride}
        aria-label="Close dialog"
      >
        ✕
      </Button>
    </header>

    <form
      class="dialog__body"
      onsubmit={(e) => {
        e.preventDefault();
        saveOverride().catch(() => {
          overrideError = 'Failed to save category.';
        });
      }}
      novalidate
    >
      <p class="dialog__desc">
        <strong>{overrideTransaction.description}</strong><br />
        {formatDate(overrideTransaction.date)} · {formatCurrency(overrideTransaction.amount)}
      </p>

      {#if overrideError}
        <p class="form-error" role="alert">{overrideError}</p>
      {/if}

      <div class="field">
        <label class="field__label" for="override-category">
          Category <span aria-hidden="true">*</span>
        </label>
        <Select
          id="override-category"
          class="field__select"
          bind:value={overrideCategory}
          required
        >
          <option value="">— Select a category —</option>
          {#each CATEGORIES as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </Select>
      </div>

      <footer class="dialog__footer">
        <Button
          class="btn btn--ghost"
          type="button"
          onclick={closeOverride}
          disabled={overrideSaving}
        >
          Cancel
        </Button>
        <Button class="btn btn--primary" type="submit" disabled={overrideSaving}>
          {overrideSaving ? 'Saving…' : 'Save Category'}
        </Button>
      </footer>
    </form>
  </Dialog>
{/if}

<style>
  /* ── Layout ──────────────────────────────────────────────────────────────── */
  .transactions-page {
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
    min-width: 9rem;
    flex: 1;
  }

  .filter-field--sm {
    min-width: 6rem;
    flex: 0 0 6rem;
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

  /* ── Transaction table ───────────────────────────────────────────────────── */
  .tx-table {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    overflow: hidden;
    background: var(--color-surface, #ffffff);
  }

  /* Header row */
  .tx-table__head {
    display: grid;
    grid-template-columns: 7rem 1fr 7rem 8rem 9rem 6.5rem 9rem;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    background: var(--color-surface-2, #f3f4f6);
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }

  .tx-table__th {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button.tx-table__th {
    cursor: pointer;
  }

  button.tx-table__th:hover {
    color: var(--color-text, #111827);
  }

  .sort-icon {
    opacity: 0.6;
  }

  /* Data rows */
  .tx-row {
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }

  .tx-row:last-child {
    border-bottom: none;
  }

  .tx-row__main {
    display: grid;
    grid-template-columns: 7rem 1fr 7rem 8rem 9rem 6.5rem 9rem;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    align-items: center;
    transition: background 0.1s ease;
  }

  .tx-row:hover .tx-row__main {
    background: var(--color-surface-2, #f9fafb);
  }

  .tx-row--expanded .tx-row__main {
    background: var(--color-surface-2, #f9fafb);
  }

  .tx-row__date {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
  }

  .tx-row__vendor {
    font-size: 0.875rem;
    color: var(--color-text, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tx-row__amount {
    font-size: 0.875rem;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
  }

  .tx-row__amount--credit {
    color: var(--color-success, #16a34a);
  }

  .tx-row__amount--debit {
    color: var(--color-text, #111827);
  }

  .tx-row__account {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tx-row__category {
    font-size: 0.8125rem;
  }

  .tx-row__confidence {
    font-size: 0.8125rem;
  }

  .tx-row__actions {
    display: flex;
    gap: var(--space-1, 0.25rem);
    justify-content: flex-end;
  }

  /* ── Category tag ────────────────────────────────────────────────────────── */
  .category-tag {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.125rem var(--space-2, 0.5rem);
    border-radius: var(--radius-full, 9999px);
    background: var(--color-primary-subtle, #eef2ff);
    color: var(--color-primary, #4f46e5);
    white-space: nowrap;
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .category-tag--none {
    background: var(--color-surface-2, #f3f4f6);
    color: var(--color-text-subtle, #9ca3af);
  }

  /* ── Confidence badge ────────────────────────────────────────────────────── */
  .confidence-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.125rem var(--space-2, 0.5rem);
    border-radius: var(--radius-full, 9999px);
    white-space: nowrap;
  }

  /* Green ≥ 90% */
  .confidence-badge--high {
    background: var(--color-success-subtle, #dcfce7);
    color: var(--color-success, #15803d);
  }

  /* Yellow 70-89% */
  .confidence-badge--medium {
    background: var(--color-warning-subtle, #fef9c3);
    color: var(--color-warning, #a16207);
  }

  /* Red < 70% */
  .confidence-badge--low {
    background: var(--color-danger-subtle, #fee2e2);
    color: var(--color-danger, #b91c1c);
  }

  .confidence-badge--none {
    background: var(--color-surface-2, #f3f4f6);
    color: var(--color-text-subtle, #9ca3af);
  }

  /* ── Expanded detail panel ───────────────────────────────────────────────── */
  .tx-row__detail {
    padding: var(--space-4, 1rem) var(--space-6, 1.5rem);
    background: var(--color-surface-2, #f9fafb);
    border-top: 1px solid var(--color-border, #e5e7eb);
  }

  .tx-detail__loading,
  .tx-detail__empty {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0;
  }

  .tx-detail__meta {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: var(--space-3, 0.75rem);
    margin-top: var(--space-4, 1rem);
    font-size: 0.8125rem;
  }

  .tx-detail__meta > div {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .tx-detail__meta dt {
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
  }

  .tx-detail__meta dd {
    color: var(--color-text, #111827);
    margin: 0;
  }

  /* ── Decision chain ──────────────────────────────────────────────────────── */
  .decision-chain {
    list-style: none;
    padding: 0;
    margin: 0;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    font-size: 0.6875rem;
    font-weight: 700;
    border-radius: 50%;
    background: var(--color-primary, #6366f1);
    color: #ffffff;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .decision-chain__content {
    font-size: 0.75rem;
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-md, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
    margin: 0;
    flex: 1;
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

  .dialog__desc {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0;
    line-height: 1.5;
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

  .btn--sm {
    padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
    font-size: 0.8125rem;
  }

  .btn--icon {
    padding: var(--space-1, 0.25rem);
    border: none;
    font-size: 1rem;
    line-height: 1;
  }

  .btn--icon-only {
    padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
    border-color: transparent;
    font-size: 0.75rem;
  }

  /* ── Screen reader only ──────────────────────────────────────────────────── */
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
