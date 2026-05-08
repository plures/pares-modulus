<script lang="ts">
  import { onMount } from 'svelte';
  import { Box, List, ListItem, Text } from '@plures/design-dojo';
  import { getPluginContext } from '../../lib/context.js';
  import {
    FA_TRANSACTIONS_COLLECTION,
    FA_INFERENCES_COLLECTION,
    confidenceLevel,
    type Transaction,
    type TransactionInference,
    type ConfidenceLevel,
  } from '../../lib/transactions.js';

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const fmt = (n: number) => currencyFormatter.format(n);

  // ── State ─────────────────────────────────────────────────────────────────
  let loading = $state(true);
  // eslint-disable-next-line plures/no-raw-stores
  let transactions = $state<Transaction[]>([]);
  // eslint-disable-next-line plures/no-raw-stores
  let inferences = $state<TransactionInference[]>([]);

  // ── Derived: category inference map ──────────────────────────────────────
  // eslint-disable-next-line plures/no-raw-stores
  const inferenceMap = $derived(
    new Map<string, TransactionInference>(
      inferences
        .filter(inf => inf.field === 'category')
        .map(inf => [inf.transactionId, inf]),
    ),
  );

  // ── Derived: last 5 transactions sorted by date desc ─────────────────────
  // eslint-disable-next-line plures/no-raw-stores
  const recentTransactions = $derived(
    transactions
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.importedAt.localeCompare(a.importedAt))
      .slice(0, 5),
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
      ctx
        .data
        .collection<TransactionInference>(FA_INFERENCES_COLLECTION)
        .query({ field: 'category' }),
    ])
      .then(([txs, infs]) => {
        transactions = txs;
        inferences = infs;
      })
      .catch(() => {
        ctx.notify?.error?.('Failed to load recent transactions.');
      })
      .finally(() => {
        loading = false;
      });
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function formatDate(dateStr: string): string {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  function truncate(str: string, max: number): string {
    return str.length > max ? `${str.slice(0, max)}…` : str;
  }

  const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
    high: 'High',
    medium: 'Med',
    low: 'Low',
  };
</script>

<Box class="widget" aria-label="Recent Transactions">
  {#if loading}
    <Box class="widget__skeleton" aria-busy="true" aria-label="Loading recent transactions" gap="var(--space-2, 0.5rem)">
      {#each [1, 2, 3, 4, 5] as _}
        <Box class="skeleton-row" />
      {/each}
    </Box>

  {:else if transactions.length === 0}
    <Box class="widget__empty" role="region" aria-label="No transactions yet" align="center" gap="var(--space-2, 0.5rem)">
      <Text class="widget__empty-icon" aria-hidden="true">💳</Text>
      <Text as="p" class="widget__empty-text">No transactions yet.</Text>
    </Box>

  {:else}
    <List class="tx-list" aria-label="Recent transactions">
      {#each recentTransactions as tx (tx.id)}
        {@const inf = inferenceMap.get(tx.id)}
        {@const category = typeof inf?.value === 'string' ? inf.value : null}
        {@const confLevel = inf ? confidenceLevel(inf.confidence) : null}
        <ListItem class="tx-row">
          <!-- Date + description -->
          <Box class="tx-row__main" gap="2px">
            <Text class="tx-row__date">{formatDate(tx.date)}</Text>
            <Text class="tx-row__desc" title={tx.description}>
              {truncate(tx.description, 28)}
            </Text>
          </Box>

          <!-- Amount + category badge -->
          <Box class="tx-row__aside" gap="2px" align="flex-end">
            <Text
              class="tx-row__amount"
              class:tx-row__amount--credit={tx.amount > 0}
              class:tx-row__amount--debit={tx.amount < 0}
            >
              {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
            </Text>
            {#if category}
              <Box class="tx-row__badges" direction="row" wrap justify="flex-end" gap="var(--space-1, 0.25rem)">
                <Text class="badge badge--category" title={category}>
                  {truncate(category, 14)}
                </Text>
                {#if confLevel}
                  <Text
                    class={`badge badge--confidence badge--confidence-${confLevel}`}
                    aria-label={`Confidence: ${CONFIDENCE_LABELS[confLevel]}`}
                  >
                    {CONFIDENCE_LABELS[confLevel]}
                  </Text>
                {/if}
              </Box>
            {/if}
          </Box>
        </ListItem>
      {/each}
    </List>
  {/if}
</Box>

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
    gap: var(--space-2, 0.5rem);
  }

  .skeleton-row {
    height: 2.75rem;
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

  /* ── Transaction list ──────────────────────────────────────────────────── */
  .tx-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  /* ── Transaction row ───────────────────────────────────────────────────── */
  .tx-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-2, 0.5rem) 0;
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }

  .tx-row:last-child {
    border-bottom: none;
  }

  .tx-row__main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .tx-row__date {
    font-size: 0.75rem;
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
  }

  .tx-row__desc {
    font-size: 0.875rem;
    color: var(--color-text, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Aside: amount + badges ────────────────────────────────────────────── */
  .tx-row__aside {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .tx-row__amount {
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
    color: var(--color-text, #111827);
  }

  .tx-row__amount--credit {
    color: var(--color-success, #16a34a);
  }

  .tx-row__amount--debit {
    color: var(--color-danger, #dc2626);
  }

  /* ── Badges ────────────────────────────────────────────────────────────── */
  .tx-row__badges {
    display: flex;
    gap: var(--space-1, 0.25rem);
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: var(--radius-full, 9999px);
    font-size: 0.6875rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .badge--category {
    background: var(--color-surface-2, #f3f4f6);
    color: var(--color-text-muted, #6b7280);
  }

  .badge--confidence {
    color: #fff;
  }

  .badge--confidence-high {
    background: var(--color-success, #16a34a);
  }

  .badge--confidence-medium {
    background: var(--color-warning, #d97706);
  }

  .badge--confidence-low {
    background: var(--color-text-subtle, #9ca3af);
  }
</style>
