<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Box,
    Button,
    Heading,
    Input,
    Link,
    List,
    ListItem,
    Select,
    Table,
    Text,
  } from '@plures/design-dojo';
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
  // eslint-disable-next-line plures/no-raw-stores
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
      const accountIdForDuplicates = selectedAccountId;
      const existing: Transaction[] =
        accountIdForDuplicates && txnCollection
          ? await txnCollection.query({ accountId: accountIdForDuplicates })
          : [];
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

    const toSave = newRows;
    if (toSave.length === 0) return;

    stage = 'committing';
    progress = 0;
    const now = new Date().toISOString();

    // Track which row IDs were saved so we can mark them as duplicates on
    // partial failure — preventing re-saving them on a retry.
    const savedIds = new Set<string>();

    try {
      let saved = 0;
      for (const draft of toSave) {
        const txn: Transaction = {
          ...draft,
          accountId: selectedAccountId,
          importedAt: now,
        };
        await txnCollection.put(txn.id, txn);
        savedIds.add(txn.id);
        saved++;
        progress = Math.round((saved / toSave.length) * 100);
      }
      ctx?.notify.success(`Imported ${saved} transaction${saved === 1 ? '' : 's'}.`);
      stage = 'done';
    } catch {
      ctx?.notify.error('Import failed. Some transactions may not have been saved.');
      // Mark successfully-saved rows as duplicates so retrying skips them.
      if (savedIds.size > 0) {
        previewRows = previewRows.map(r =>
          savedIds.has(r.id) ? { ...r, duplicate: true } : r,
        );
      }
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

  // eslint-disable-next-line plures/no-raw-stores
  const accountOptions = $derived(
    accounts.map(account => ({
      value: account.id,
      label: `${account.name}${account.institution ? ` — ${account.institution}` : ''}`,
    })),
  );
</script>

<!-- ── Page ─────────────────────────────────────────────────────────────── -->
<Box class="import-page">
  <!-- Header -->
  <Box as="header" class="page-header" direction="row" justify="space-between" align="flex-start">
    <Box class="page-header__text" gap="0">
      <Heading class="page-header__title" level={1}>Import Transactions</Heading>
      <Text as="p" class="page-header__subtitle">
        Upload a CSV, OFX, or QFX export from your bank. Duplicate transactions are
        automatically skipped.
      </Text>
    </Box>
    {#if stage === 'preview' || stage === 'done'}
      <Button class="btn btn--ghost" onclick={resetImport}>
        ← Start Over
      </Button>
    {/if}
  </Box>

  <!-- Account selector -->
  {#if accounts.length > 0 && stage !== 'done'}
    <Box class="account-selector" gap="var(--space-2, 0.5rem)">
      <Select
        name="target-account"
        class="field__select"
        bind:value={selectedAccountId}
        label="Import into account"
        disabled={stage === 'preview' || stage === 'committing'}
        options={accountOptions}
      />
    </Box>
  {/if}

  <!-- ── Idle / Drop zone ────────────────────────────────────────────────── -->
  {#if stage === 'idle'}
    {#if parseError}
      <Box class="alert alert--error" role="alert">{parseError}</Box>
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <Box
      as="label"
      class="drop-zone"
      class:drop-zone--over={isDragOver}
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      aria-label="Upload file — drag and drop or click to browse"
    >
      <Text class="drop-zone__icon" aria-hidden="true">📥</Text>
      <Text class="drop-zone__primary">
        Drag &amp; drop a file here, or <Text as="span" class="drop-zone__browse">browse</Text>
      </Text>
      <Text class="drop-zone__secondary">Supports CSV, OFX, and QFX formats</Text>
      <Input
        name="file-input"
        class="drop-zone__input"
        type="file"
        accept=".csv,.ofx,.qfx"
        onchange={handleFileInput}
        aria-hidden="true"
      />
    </Box>

    <Box class="format-hints">
      <Text as="p" class="format-hints__title">Supported bank formats</Text>
      <List class="format-hints__list">
        <ListItem>🏦 <Text as="strong">Chase</Text> — CSV export from chase.com</ListItem>
        <ListItem>🏦 <Text as="strong">Bank of America</Text> — CSV export</ListItem>
        <ListItem>🏦 <Text as="strong">Wells Fargo</Text> — CSV export</ListItem>
        <ListItem>📄 <Text as="strong">OFX / QFX</Text> — Any bank supporting Open Financial Exchange</ListItem>
      </List>
    </Box>
  {/if}

  <!-- ── Parsing / progress ─────────────────────────────────────────────── -->
  {#if stage === 'parsing' || stage === 'committing'}
    <Box class="progress-container" role="status" aria-live="polite">
      <Text as="p" class="progress-label">
        {stage === 'parsing' ? 'Parsing file…' : `Saving transactions… (${progress}%)`}
      </Text>
      <Box class="progress-bar" aria-label="Progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <Box class="progress-bar__fill" style={`width: ${progress}%`} />
      </Box>
    </Box>
  {/if}

  <!-- ── Preview ────────────────────────────────────────────────────────── -->
  {#if stage === 'preview'}
    <Box class="preview-summary" direction="row" wrap gap="var(--space-2, 0.5rem)">
      <Box class="summary-chip summary-chip--new" direction="row" align="center" gap="var(--space-2, 0.5rem)">
        <Text class="summary-chip__count">{newRows.length}</Text>
        <Text>new transaction{newRows.length === 1 ? '' : 's'}</Text>
      </Box>
      {#if dupRows.length > 0}
        <Box class="summary-chip summary-chip--dup" direction="row" align="center" gap="var(--space-2, 0.5rem)">
          <Text class="summary-chip__count">{dupRows.length}</Text>
          <Text>duplicate{dupRows.length === 1 ? '' : 's'} (will be skipped)</Text>
        </Box>
      {/if}
      {#if detectedFormat}
        <Box class="summary-chip summary-chip--format">
          {formatFormatLabel(String(detectedFormat))}
        </Box>
      {/if}
    </Box>

    <Box class="table-wrapper" role="region" aria-label="Transaction preview" tabindex="0">
      <Table class="preview-table" aria-label="Imported transactions preview">
        <Box as="thead">
          <Box as="tr">
            <Box as="th">Date</Box>
            <Box as="th">Description</Box>
            <Box as="th" class="col--amount">Amount</Box>
            <Box as="th">Status</Box>
          </Box>
        </Box>
        <Box as="tbody">
          {#each previewRows as row (row.id)}
            <Box as="tr" class:row--dup={row.duplicate}>
              <Box as="td" class="col--date">{row.date}</Box>
              <Box as="td" class="col--desc">{row.description || '—'}</Box>
              <Box
                as="td"
                class="col--amount"
                class:amount--negative={row.amount < 0}
                class:amount--positive={row.amount > 0}
              >
                {formatCurrency(row.amount)}
              </Box>
              <Box as="td">
                {#if row.duplicate}
                  <Text class="badge badge--dup" aria-label="Duplicate — will be skipped">
                    Duplicate
                  </Text>
                {:else}
                  <Text class="badge badge--new" aria-label="New transaction">New</Text>
                {/if}
              </Box>
            </Box>
          {/each}
        </Box>
      </Table>
    </Box>

    <Box as="footer" class="preview-footer" direction="row" justify="space-between" align="center">
      <Button class="btn btn--ghost" onclick={resetImport} disabled={stage !== 'preview'}>
        Cancel
      </Button>
      <Button
        class="btn btn--primary"
        onclick={() => {
          commitImport().catch(() => ctx?.notify.error('Import failed.'));
        }}
        disabled={!canCommit}
        aria-disabled={!canCommit}
      >
        Import {newRows.length} Transaction{newRows.length === 1 ? '' : 's'}
      </Button>
    </Box>
  {/if}

  <!-- ── Done ───────────────────────────────────────────────────────────── -->
  {#if stage === 'done'}
    <Box class="done-state" role="status" align="center" gap="var(--space-3, 0.75rem)">
      <Text class="done-state__icon" aria-hidden="true">✅</Text>
      <Heading class="done-state__heading" level={2}>Import Complete</Heading>
      <Text as="p" class="done-state__body">
        {newRows.length} transaction{newRows.length === 1 ? '' : 's'} saved to
        <Text as="strong">{accounts.find(a => a.id === selectedAccountId)?.name ?? 'your account'}</Text>.
        {#if dupRows.length > 0}
          {dupRows.length} duplicate{dupRows.length === 1 ? '' : 's'} were skipped.
        {/if}
      </Text>
      <Box class="done-state__actions" direction="row" gap="var(--space-2, 0.5rem)" justify="center" wrap>
        <Link class="btn btn--primary" href="/financial-advisor/transactions">
          View Transactions
        </Link>
        <Button class="btn btn--ghost" onclick={resetImport}>
          Import Another File
        </Button>
      </Box>
    </Box>
  {/if}
</Box>

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
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .drop-zone--over {
    border-color: var(--color-primary, #6366f1);
    background: var(--color-surface-2, #f3f4f6);
  }

  .drop-zone__icon {
    font-size: 2.5rem;
  }

  .drop-zone__primary {
    font-weight: 600;
    color: var(--color-text, #111827);
  }

  .drop-zone__browse {
    color: var(--color-primary, #6366f1);
  }

  .drop-zone__secondary {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
  }

  .drop-zone__input {
    display: none;
  }

  /* ── Alerts ─────────────────────────────────────────────────────────────── */
  .alert {
    padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
    border-radius: var(--radius-md, 0.5rem);
    font-size: 0.875rem;
  }

  .alert--error {
    background: var(--color-danger-subtle, #fef2f2);
    color: var(--color-danger, #dc2626);
    border: 1px solid var(--color-danger-border, #fecaca);
  }

  /* ── Format hints ────────────────────────────────────────────────────────── */
  .format-hints {
    margin-top: var(--space-4, 1rem);
  }

  .format-hints__title {
    font-weight: 600;
    margin: 0 0 var(--space-2, 0.5rem) 0;
  }

  .format-hints__list {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }

  /* ── Progress ────────────────────────────────────────────────────────────── */
  .progress-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
  }

  .progress-label {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
  }

  .progress-bar {
    height: 0.5rem;
    background: var(--color-surface-2, #f3f4f6);
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
  }

  .progress-bar__fill {
    height: 100%;
    background: var(--color-primary, #6366f1);
    transition: width 0.2s ease;
  }

  /* ── Preview summary ─────────────────────────────────────────────────────── */
  .preview-summary {
    display: flex;
    gap: var(--space-2, 0.5rem);
    flex-wrap: wrap;
  }

  .summary-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-full, 9999px);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .summary-chip__count {
    font-weight: 700;
  }

  .summary-chip--new {
    background: var(--color-success-subtle, #f0fdf4);
    color: var(--color-success, #16a34a);
    border: 1px solid var(--color-success-border, #bbf7d0);
  }

  .summary-chip--dup {
    background: var(--color-warning-subtle, #fffbeb);
    color: var(--color-warning, #d97706);
    border: 1px solid var(--color-warning-border, #fde68a);
  }

  .summary-chip--format {
    background: var(--color-surface-2, #f3f4f6);
    color: var(--color-text-muted, #6b7280);
  }

  /* ── Table ──────────────────────────────────────────────────────────────── */
  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
  }

  .preview-table :global(th) {
    text-align: left;
    font-weight: 600;
    padding: 0.75rem 1rem;
    background: var(--color-surface-2, #f3f4f6);
  }

  .preview-table :global(td) {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--color-border, #e5e7eb);
    font-size: 0.875rem;
  }

  .col--amount {
    text-align: right;
    white-space: nowrap;
  }

  .col--date {
    white-space: nowrap;
  }

  .row--dup {
    opacity: 0.6;
  }

  .amount--positive {
    color: var(--color-success, #16a34a);
  }

  .amount--negative {
    color: var(--color-danger, #dc2626);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-full, 9999px);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge--new {
    background: var(--color-success-subtle, #f0fdf4);
    color: var(--color-success, #16a34a);
  }

  .badge--dup {
    background: var(--color-warning-subtle, #fffbeb);
    color: var(--color-warning, #d97706);
  }

  /* ── Preview footer ─────────────────────────────────────────────────────── */
  .preview-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2, 0.5rem);
  }

  /* ── Done state ─────────────────────────────────────────────────────────── */
  .done-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-8, 2rem) var(--space-4, 1rem);
  }

  .done-state__icon {
    font-size: 2.5rem;
  }

  .done-state__heading {
    font-size: 1.5rem;
    margin: 0;
  }

  .done-state__body {
    font-size: 0.9375rem;
    color: var(--color-text-muted, #6b7280);
    line-height: 1.6;
    margin: 0;
    max-width: 36rem;
  }

  .done-state__actions {
    display: flex;
    gap: var(--space-2, 0.5rem);
    flex-wrap: wrap;
    justify-content: center;
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
</style>
