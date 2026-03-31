<script lang="ts">
  import { onMount } from 'svelte';
  import { getPluginContext } from '../lib/context.js';
  import {
    FA_TRANSACTIONS_COLLECTION,
    type Transaction,
    type ImportSource,
  } from '../lib/transactions.js';
  import { FA_ACCOUNTS_COLLECTION, type Account } from '../lib/accounts.js';
  import { parseCsv, csvRowsToTransactions, type BankFormat } from '../lib/parsers/csv.js';
  import { parseOfx, ofxTransactionsToTransactions } from '../lib/parsers/ofx.js';

  // ── Plugin context ────────────────────────────────────────────────────────
  let ctx: ReturnType<typeof getPluginContext>;
  let txnCollection: any;
  let acctCollection: any;

  // ── Accounts ──────────────────────────────────────────────────────────────
  let accounts = $state<Account[]>([]);
  let selectedAccountId = $state('');

  // ── File / parse state ────────────────────────────────────────────────────
  type Stage = 'idle' | 'parsing' | 'preview' | 'committing' | 'done';
  let stage = $state<Stage>('idle');
  let parseError = $state('');
  let detectedFormat = $state<BankFormat | 'ofx' | 'qfx' | ''>('');
  let progress = $state(0); // 0-100

  // ── Drag-and-drop state ───────────────────────────────────────────────────
  let isDragOver = $state(false);

  // ── Preview state ─────────────────────────────────────────────────────────
  type PreviewRow = Omit<Transaction, 'accountId' | 'importedAt'> & { duplicate: boolean };
  let previewRows = $state<PreviewRow[]>([]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const newRows = $derived(previewRows.filter(r => !r.duplicate));
  const dupRows = $derived(previewRows.filter(r => r.duplicate));
  const canCommit = $derived(newRows.length > 0 && selectedAccountId !== '' && stage === 'preview');

  // ── Init ──────────────────────────────────────────────────────────────────
  onMount(() => {
    ctx = getPluginContext();
    txnCollection = ctx?.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION);
    acctCollection = ctx?.data.collection<Account>(FA_ACCOUNTS_COLLECTION);
    loadAccounts().catch(() => ctx?.notify.error('Failed to load accounts.'));
  });

  async function loadAccounts(): Promise<void> {
    accounts = (await acctCollection?.query()) ?? [];
    if (accounts.length > 0) selectedAccountId = accounts[0].id;
  }

  // ── File input ────────────────────────────────────────────────────────────
  function handleFileInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) processFile(file);
    input.value = ''; // allow re-selecting same file
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    isDragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave(): void {
    isDragOver = false;
  }

  // ── File processing ───────────────────────────────────────────────────────
  async function processFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith('.csv');
    const isOfx = name.endsWith('.ofx');
    const isQfx = name.endsWith('.qfx');

    if (!isCsv && !isOfx && !isQfx) {
      parseError = 'Unsupported file type. Please upload a .csv, .ofx, or .qfx file.';
      return;
    }

    parseError = '';
    stage = 'parsing';
    progress = 10;

    try {
      const text = await file.text();
      progress = 30;

      let drafts: Omit<Transaction, 'accountId' | 'importedAt'>[];
      let fmt: typeof detectedFormat;

      if (isCsv) {
        const result = parseCsv(text);
        fmt = result.format;
        progress = 60;
        drafts = await csvRowsToTransactions(result.rows, 'csv');
      } else {
        const result = parseOfx(text);
        fmt = isQfx ? 'qfx' : 'ofx';
        progress = 60;
        const src: ImportSource = isQfx ? 'qfx' : 'ofx';
        drafts = ofxTransactionsToTransactions(result.transactions, src);
      }

      if (drafts.length === 0) {
        parseError = 'No transactions found in this file. Please check the file format.';
        stage = 'idle';
        progress = 0;
        return;
      }

      detectedFormat = fmt;
      progress = 80;

      // ── Duplicate detection ────────────────────────────────────────────────
      const existing: Transaction[] = (await txnCollection?.query()) ?? [];
      const existingFitIds = new Set(existing.map(t => t.fitId).filter(Boolean));
      const existingHashes = new Set(existing.map(t => t.hash).filter(Boolean));

      previewRows = drafts.map(d => ({
        ...d,
        duplicate: d.fitId
          ? existingFitIds.has(d.fitId)
          : d.hash
            ? existingHashes.has(d.hash)
            : false,
      }));

      progress = 100;
      stage = 'preview';
    } catch (err) {
      parseError = `Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`;
      stage = 'idle';
      progress = 0;
    }
  }

  // ── Commit ────────────────────────────────────────────────────────────────
  async function commitImport(): Promise<void> {
    if (!txnCollection || !selectedAccountId) return;

    stage = 'committing';
    const now = new Date().toISOString();
    const toSave = newRows;

    let saved = 0;
    try {
      for (const draft of toSave) {
        const txn: Transaction = {
          ...draft,
          accountId: selectedAccountId,
          importedAt: now,
        };
        await txnCollection.put(txn.id, txn);
        saved++;
        progress = Math.round((saved / toSave.length) * 100);
      }
      ctx?.notify.success(`Imported ${saved} transaction${saved === 1 ? '' : 's'}.`);
      stage = 'done';
    } catch {
      ctx?.notify.error('Import failed. Some transactions may not have been saved.');
      stage = 'preview';
    }
  }

  function resetImport(): void {
    stage = 'idle';
    parseError = '';
    previewRows = [];
    detectedFormat = '';
    progress = 0;
  }

  // ── Formatting helpers ─────────────────────────────────────────────────────
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }

  function formatFormatLabel(fmt: string): string {
    const labels: Record<string, string> = {
      chase: 'Chase',
      bofa: 'Bank of America',
      'wells-fargo': 'Wells Fargo',
      generic: 'Generic CSV',
      ofx: 'OFX',
      qfx: 'QFX (Quicken)',
    };
    return labels[fmt] ?? fmt;
  }
</script>

<!-- ── Page ─────────────────────────────────────────────────────────────── -->
<div class="import-page">
  <!-- Header -->
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">Import Transactions</h1>
      <p class="page-header__subtitle">
        Upload a CSV, OFX, or QFX export from your bank. Duplicate transactions are
        automatically skipped.
      </p>
    </div>
    {#if stage === 'preview' || stage === 'done'}
      <button class="btn btn--ghost" onclick={resetImport}>
        ← Start Over
      </button>
    {/if}
  </header>

  <!-- Account selector -->
  {#if accounts.length > 0 && stage !== 'done'}
    <div class="account-selector">
      <label class="field__label" for="target-account">Import into account</label>
      <select
        id="target-account"
        class="field__select"
        bind:value={selectedAccountId}
        disabled={stage === 'committing'}
      >
        {#each accounts as account (account.id)}
          <option value={account.id}>{account.name}{account.institution ? ` — ${account.institution}` : ''}</option>
        {/each}
      </select>
    </div>
  {/if}

  <!-- ── Idle / Drop zone ────────────────────────────────────────────────── -->
  {#if stage === 'idle'}
    {#if parseError}
      <div class="alert alert--error" role="alert">{parseError}</div>
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <label
      class="drop-zone"
      class:drop-zone--over={isDragOver}
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      aria-label="Upload file — drag and drop or click to browse"
      for="file-input"
    >
      <span class="drop-zone__icon" aria-hidden="true">📥</span>
      <span class="drop-zone__primary">
        Drag &amp; drop a file here, or <span class="drop-zone__browse">browse</span>
      </span>
      <span class="drop-zone__secondary">Supports CSV, OFX, and QFX formats</span>
      <input
        id="file-input"
        class="drop-zone__input"
        type="file"
        accept=".csv,.ofx,.qfx"
        onchange={handleFileInput}
        aria-hidden="true"
        tabindex="-1"
      />
    </label>

    <div class="format-hints">
      <p class="format-hints__title">Supported bank formats</p>
      <ul class="format-hints__list">
        <li>🏦 <strong>Chase</strong> — CSV export from chase.com</li>
        <li>🏦 <strong>Bank of America</strong> — CSV export</li>
        <li>🏦 <strong>Wells Fargo</strong> — CSV export</li>
        <li>📄 <strong>OFX / QFX</strong> — Any bank supporting Open Financial Exchange</li>
      </ul>
    </div>
  {/if}

  <!-- ── Parsing / progress ─────────────────────────────────────────────── -->
  {#if stage === 'parsing' || stage === 'committing'}
    <div class="progress-container" role="status" aria-live="polite">
      <p class="progress-label">
        {stage === 'parsing' ? 'Parsing file…' : `Saving transactions… (${progress}%)`}
      </p>
      <div class="progress-bar" aria-label="Progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div class="progress-bar__fill" style="width: {progress}%"></div>
      </div>
    </div>
  {/if}

  <!-- ── Preview ────────────────────────────────────────────────────────── -->
  {#if stage === 'preview'}
    <div class="preview-summary">
      <div class="summary-chip summary-chip--new">
        <span class="summary-chip__count">{newRows.length}</span>
        new transaction{newRows.length === 1 ? '' : 's'}
      </div>
      {#if dupRows.length > 0}
        <div class="summary-chip summary-chip--dup">
          <span class="summary-chip__count">{dupRows.length}</span>
          duplicate{dupRows.length === 1 ? '' : 's'} (will be skipped)
        </div>
      {/if}
      {#if detectedFormat}
        <div class="summary-chip summary-chip--format">
          {formatFormatLabel(String(detectedFormat))}
        </div>
      {/if}
    </div>

    <div class="table-wrapper" role="region" aria-label="Transaction preview" tabindex="0">
      <table class="preview-table" aria-label="Imported transactions preview">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Description</th>
            <th scope="col" class="col--amount">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each previewRows as row (row.id)}
            <tr class:row--dup={row.duplicate}>
              <td class="col--date">{row.date}</td>
              <td class="col--desc">{row.description || '—'}</td>
              <td
                class="col--amount"
                class:amount--negative={row.amount < 0}
                class:amount--positive={row.amount > 0}
              >
                {formatCurrency(row.amount)}
              </td>
              <td>
                {#if row.duplicate}
                  <span class="badge badge--dup" aria-label="Duplicate — will be skipped">
                    Duplicate
                  </span>
                {:else}
                  <span class="badge badge--new" aria-label="New transaction">New</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <footer class="preview-footer">
      <button class="btn btn--ghost" onclick={resetImport} disabled={stage !== 'preview'}>
        Cancel
      </button>
      <button
        class="btn btn--primary"
        onclick={() => {
          commitImport().catch(() => ctx?.notify.error('Import failed.'));
        }}
        disabled={!canCommit}
        aria-disabled={!canCommit}
      >
        Import {newRows.length} Transaction{newRows.length === 1 ? '' : 's'}
      </button>
    </footer>
  {/if}

  <!-- ── Done ───────────────────────────────────────────────────────────── -->
  {#if stage === 'done'}
    <div class="done-state" role="status">
      <span class="done-state__icon" aria-hidden="true">✅</span>
      <h2 class="done-state__heading">Import Complete</h2>
      <p class="done-state__body">
        {newRows.length} transaction{newRows.length === 1 ? '' : 's'} saved to
        <strong>{accounts.find(a => a.id === selectedAccountId)?.name ?? 'your account'}</strong>.
        {#if dupRows.length > 0}
          {dupRows.length} duplicate{dupRows.length === 1 ? '' : 's'} were skipped.
        {/if}
      </p>
      <div class="done-state__actions">
        <a class="btn btn--primary" href="/financial-advisor/transactions">
          View Transactions
        </a>
        <button class="btn btn--ghost" onclick={resetImport}>
          Import Another File
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Layout ──────────────────────────────────────────────────────────────── */
  .import-page {
    padding: var(--space-6, 1.5rem);
    max-width: 56rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6, 1.5rem);
  }

  /* ── Page header ─────────────────────────────────────────────────────────── */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4, 1rem);
  }

  .page-header__title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    color: var(--color-text, #111827);
  }

  .page-header__subtitle {
    font-size: 0.9375rem;
    color: var(--color-text-muted, #6b7280);
    margin: var(--space-1, 0.25rem) 0 0;
    max-width: 40rem;
    line-height: 1.5;
  }

  /* ── Account selector ────────────────────────────────────────────────────── */
  .account-selector {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
    max-width: 24rem;
  }

  /* ── Drop zone ───────────────────────────────────────────────────────────── */
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-12, 3rem) var(--space-6, 1.5rem);
    border: 2px dashed var(--color-border, #d1d5db);
    border-radius: var(--radius-xl, 1rem);
    background: var(--color-surface, #ffffff);
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .drop-zone:hover,
  .drop-zone--over {
    border-color: var(--color-primary, #2563eb);
    background: var(--color-primary-soft, #eff6ff);
  }

  .drop-zone__icon {
    font-size: 2.5rem;
    line-height: 1;
  }

  .drop-zone__primary {
    font-size: 1rem;
    font-weight: 500;
    color: var(--color-text, #111827);
  }

  .drop-zone__browse {
    color: var(--color-primary, #2563eb);
    text-decoration: underline;
  }

  .drop-zone__secondary {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
  }

  .drop-zone__input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  /* ── Format hints ────────────────────────────────────────────────────────── */
  .format-hints {
    background: var(--color-surface-2, #f9fafb);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    padding: var(--space-5, 1.25rem);
  }

  .format-hints__title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 var(--space-3, 0.75rem);
  }

  .format-hints__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
    font-size: 0.9375rem;
    color: var(--color-text, #111827);
  }

  /* ── Alert ───────────────────────────────────────────────────────────────── */
  .alert {
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    border-radius: var(--radius-md, 0.5rem);
    font-size: 0.9375rem;
  }

  .alert--error {
    background: var(--color-danger-soft, #fef2f2);
    color: var(--color-danger, #dc2626);
    border: 1px solid var(--color-danger-border, #fca5a5);
  }

  /* ── Progress ────────────────────────────────────────────────────────────── */
  .progress-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-8, 2rem);
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    align-items: center;
  }

  .progress-label {
    font-size: 0.9375rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0;
  }

  .progress-bar {
    width: 100%;
    max-width: 24rem;
    height: 0.5rem;
    background: var(--color-surface-2, #f3f4f6);
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
  }

  .progress-bar__fill {
    height: 100%;
    background: var(--color-primary, #2563eb);
    border-radius: var(--radius-full, 9999px);
    transition: width 0.2s ease;
  }

  /* ── Preview summary chips ───────────────────────────────────────────────── */
  .preview-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3, 0.75rem);
    align-items: center;
  }

  .summary-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
    border-radius: var(--radius-full, 9999px);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .summary-chip--new {
    background: var(--color-success-soft, #f0fdf4);
    color: var(--color-success, #16a34a);
    border: 1px solid var(--color-success-border, #bbf7d0);
  }

  .summary-chip--dup {
    background: var(--color-warning-soft, #fffbeb);
    color: var(--color-warning, #d97706);
    border: 1px solid var(--color-warning-border, #fde68a);
  }

  .summary-chip--format {
    background: var(--color-surface-2, #f3f4f6);
    color: var(--color-text-muted, #6b7280);
    border: 1px solid var(--color-border, #e5e7eb);
  }

  .summary-chip__count {
    font-size: 1rem;
    font-weight: 700;
  }

  /* ── Preview table ───────────────────────────────────────────────────────── */
  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    max-height: 28rem;
    overflow-y: auto;
  }

  .preview-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
  }

  .preview-table thead {
    position: sticky;
    top: 0;
    background: var(--color-surface-2, #f9fafb);
    z-index: 1;
  }

  .preview-table th {
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    text-align: left;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--color-border, #e5e7eb);
    white-space: nowrap;
  }

  .preview-table td {
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    border-bottom: 1px solid var(--color-border-subtle, #f3f4f6);
    vertical-align: middle;
  }

  .preview-table tr:last-child td {
    border-bottom: none;
  }

  .row--dup {
    opacity: 0.5;
  }

  .col--date {
    white-space: nowrap;
    color: var(--color-text-muted, #6b7280);
    font-size: 0.875rem;
    width: 7rem;
  }

  .col--desc {
    max-width: 20rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text, #111827);
  }

  .col--amount {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .amount--negative {
    color: var(--color-danger, #dc2626);
  }

  .amount--positive {
    color: var(--color-success, #16a34a);
  }

  /* ── Badges ──────────────────────────────────────────────────────────────── */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem var(--space-2, 0.5rem);
    border-radius: var(--radius-full, 9999px);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .badge--new {
    background: var(--color-success-soft, #f0fdf4);
    color: var(--color-success, #16a34a);
  }

  .badge--dup {
    background: var(--color-warning-soft, #fffbeb);
    color: var(--color-warning, #d97706);
  }

  /* ── Preview footer ──────────────────────────────────────────────────────── */
  .preview-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3, 0.75rem);
  }

  /* ── Done state ──────────────────────────────────────────────────────────── */
  .done-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-16, 4rem) var(--space-6, 1.5rem);
    gap: var(--space-4, 1rem);
  }

  .done-state__icon {
    font-size: 3rem;
    line-height: 1;
  }

  .done-state__heading {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: var(--color-text, #111827);
  }

  .done-state__body {
    font-size: 0.9375rem;
    color: var(--color-text-muted, #6b7280);
    max-width: 28rem;
    margin: 0;
    line-height: 1.6;
  }

  .done-state__actions {
    display: flex;
    gap: var(--space-3, 0.75rem);
    flex-wrap: wrap;
    justify-content: center;
  }

  /* ── Shared field styles (mirrors Accounts.svelte) ───────────────────────── */
  :global(.field__label) {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text, #111827);
  }

  :global(.field__select) {
    width: 100%;
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    border: 1px solid var(--color-border, #d1d5db);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-surface, #ffffff);
    color: var(--color-text, #111827);
    font-size: 0.9375rem;
    appearance: auto;
  }

  :global(.btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    border-radius: var(--radius-md, 0.5rem);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s ease, opacity 0.15s ease;
    text-decoration: none;
  }

  :global(.btn:disabled),
  :global(.btn[aria-disabled='true']) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.btn--primary) {
    background: var(--color-primary, #2563eb);
    color: #fff;
  }

  :global(.btn--primary:hover:not(:disabled)) {
    background: var(--color-primary-hover, #1d4ed8);
  }

  :global(.btn--ghost) {
    background: transparent;
    color: var(--color-text, #111827);
    border-color: var(--color-border, #d1d5db);
  }

  :global(.btn--ghost:hover:not(:disabled)) {
    background: var(--color-surface-2, #f3f4f6);
  }
</style>
