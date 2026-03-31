<script lang="ts">
  import { onMount } from 'svelte';
  import { getPluginContext } from '../lib/context.js';
  import {
    FA_ACCOUNTS_COLLECTION,
    ACCOUNT_TYPE_LABELS,
    ACCOUNT_TYPE_ICONS,
    generateAccountId,
    type Account,
    type AccountType,
  } from '../lib/accounts.js';

  let ctx: any;
  let collection: any;

  // ── Page state ────────────────────────────────────────────────────────────
  let accounts = $state<Account[]>([]);
  let loading = $state(true);

  // ── Form dialog state ─────────────────────────────────────────────────────
  let showForm = $state(false);
  let editingAccount = $state<Account | null>(null);
  let saving = $state(false);
  let formError = $state('');

  // ── Form fields ───────────────────────────────────────────────────────────
  let formName = $state('');
  let formInstitution = $state('');
  let formType = $state<AccountType>('checking');
  let formBalance = $state('0.00');

  // ── Delete confirmation state ─────────────────────────────────────────────
  let confirmDeleteId = $state<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalBalance = $derived(
    accounts.reduce((sum, a) => sum + a.balance, 0),
  );
  const confirmDeleteTarget = $derived(
    accounts.find(a => a.id === confirmDeleteId) ?? null,
  );
  const isEditMode = $derived(editingAccount !== null);

  // ── Load accounts on mount ────────────────────────────────────────────────
  onMount(() => {
    ctx = getPluginContext();
    collection = ctx?.data.collection<Account>(FA_ACCOUNTS_COLLECTION);
    loadAccounts().catch(() => {
      ctx?.notify.error('Failed to load accounts.');
      loading = false;
    });
  });

  async function loadAccounts(): Promise<void> {
    loading = true;
    try {
      accounts = (await collection?.query()) ?? [];
    } catch {
      ctx?.notify.error('Failed to load accounts.');
      accounts = [];
    } finally {
      loading = false;
    }
  }

  // ── Modal action — wires <dialog> to showModal() for native focus trapping,
  //    backdrop, and Escape handling. Click on ::backdrop closes the dialog.
  function useModal(node: HTMLDialogElement, params: { onClose: () => void }) {
    function handleCancel(e: Event) {
      // Prevent the browser from closing the dialog on its own so that Svelte
      // state (the {#if} block) remains the single source of truth for visibility.
      e.preventDefault();
      params.onClose();
    }
    function handleBackdropClick(e: MouseEvent) {
      // A click whose direct target is the <dialog> element itself means the
      // user clicked on the ::backdrop (outside the dialog box).
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

  // ── Form helpers ──────────────────────────────────────────────────────────
  function openCreate(): void {
    editingAccount = null;
    formName = '';
    formInstitution = '';
    formType = 'checking';
    formBalance = '0.00';
    formError = '';
    showForm = true;
  }

  function openEdit(account: Account): void {
    editingAccount = account;
    formName = account.name;
    formInstitution = account.institution;
    formType = account.type;
    formBalance = account.balance.toFixed(2);
    formError = '';
    showForm = true;
  }

  function closeForm(): void {
    showForm = false;
    editingAccount = null;
    formError = '';
  }

  async function saveAccount(): Promise<void> {
    formError = '';

    if (!formName.trim()) {
      formError = 'Account name is required.';
      return;
    }

    const balance = parseFloat(formBalance);
    if (isNaN(balance)) {
      formError = 'Balance must be a valid number.';
      return;
    }

    if (!collection) {
      formError = 'Database not available.';
      return;
    }

    saving = true;
    try {
      const now = new Date().toISOString();
      if (editingAccount) {
        const updated: Account = {
          ...editingAccount,
          name: formName.trim(),
          institution: formInstitution.trim(),
          type: formType,
          balance,
          updatedAt: now,
        };
        await collection.put(updated.id, updated);
        accounts = accounts.map(a => (a.id === updated.id ? updated : a));
        ctx?.notify.success('Account updated.');
      } else {
        const account: Account = {
          id: generateAccountId(),
          name: formName.trim(),
          institution: formInstitution.trim(),
          type: formType,
          balance,
          createdAt: now,
          updatedAt: now,
        };
        await collection.put(account.id, account);
        accounts = [...accounts, account];
        ctx?.notify.success('Account created.');
      }
      closeForm();
    } catch {
      formError = 'Failed to save account. Please try again.';
      ctx?.notify.error('Failed to save account.');
    } finally {
      saving = false;
    }
  }

  async function deleteAccount(id: string): Promise<void> {
    if (!collection) return;
    try {
      await collection.delete(id);
      accounts = accounts.filter(a => a.id !== id);
      ctx?.notify.success('Account deleted.');
    } catch {
      ctx?.notify.error('Failed to delete account.');
    }
    confirmDeleteId = null;
  }

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }
</script>

<!-- ── Page ──────────────────────────────────────────────────────────────── -->
<div class="accounts-page">
  <!-- Header -->
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">Accounts</h1>
      {#if accounts.length > 0}
        <p class="page-header__subtitle">
          {accounts.length} account{accounts.length === 1 ? '' : 's'} ·
          Net balance: {formatCurrency(totalBalance)}
        </p>
      {/if}
    </div>
    {#if accounts.length > 0}
      <button class="btn btn--primary" onclick={openCreate} aria-label="Add account">
        + Add Account
      </button>
    {/if}
  </header>

  <!-- Loading skeleton -->
  {#if loading}
    <div class="skeleton-list" aria-busy="true" aria-label="Loading accounts">
      {#each [1, 2, 3] as _}
        <div class="skeleton-card"></div>
      {/each}
    </div>

  <!-- Empty state -->
  {:else if accounts.length === 0}
    <div class="empty-state" role="region" aria-label="No accounts yet">
      <span class="empty-state__icon" aria-hidden="true">🏦</span>
      <h2 class="empty-state__heading">No accounts yet</h2>
      <p class="empty-state__body">
        Add your first bank account, credit card, or investment account to
        start tracking your finances.
      </p>
      <button class="btn btn--primary btn--lg" onclick={openCreate}>
        Add Your First Account
      </button>
    </div>

  <!-- Account list -->
  {:else}
    <ul class="account-list" aria-label="Account list">
      {#each accounts as account (account.id)}
        <li class="account-card">
          <span class="account-card__icon" aria-hidden="true">
            {ACCOUNT_TYPE_ICONS[account.type]}
          </span>
          <div class="account-card__info">
            <span class="account-card__name">{account.name}</span>
            {#if account.institution}
              <span class="account-card__institution">{account.institution}</span>
            {/if}
            <span class="account-card__type">{ACCOUNT_TYPE_LABELS[account.type]}</span>
          </div>
          <span
            class="account-card__balance"
            class:account-card__balance--negative={account.balance < 0}
          >
            {formatCurrency(account.balance)}
          </span>
          <div class="account-card__actions">
            <button
              class="btn btn--ghost btn--sm"
              onclick={() => openEdit(account)}
              aria-label={`Edit ${account.name}`}
            >
              Edit
            </button>
            <button
              class="btn btn--ghost btn--sm btn--danger"
              onclick={() => (confirmDeleteId = account.id)}
              aria-label={`Delete ${account.name}`}
            >
              Delete
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- ── Account form dialog ────────────────────────────────────────────────── -->
{#if showForm}
  <dialog
    use:useModal={{ onClose: closeForm }}
    class="dialog"
    aria-modal="true"
    aria-labelledby="dialog-title"
  >
    <header class="dialog__header">
      <h2 class="dialog__title" id="dialog-title">
        {isEditMode ? 'Edit Account' : 'Add Account'}
      </h2>
      <button
        class="btn btn--ghost btn--icon"
        onclick={closeForm}
        aria-label="Close dialog"
      >
        ✕
      </button>
    </header>

    <form
      class="dialog__body"
      onsubmit={(e) => {
        e.preventDefault();
        saveAccount().catch(() => {
          formError = 'Failed to save account. Please try again.';
        });
      }}
      novalidate
    >
      {#if formError}
        <p class="form-error" role="alert">{formError}</p>
      {/if}

      <div class="field">
        <label class="field__label" for="account-name">
          Account Name <span aria-hidden="true">*</span>
        </label>
        <input
          id="account-name"
          class="field__input"
          type="text"
          bind:value={formName}
          placeholder="e.g. Main Checking"
          required
          autocomplete="off"
        />
      </div>

      <div class="field">
        <label class="field__label" for="account-institution">
          Institution
        </label>
        <input
          id="account-institution"
          class="field__input"
          type="text"
          bind:value={formInstitution}
          placeholder="e.g. Chase, Ally, Vanguard"
          autocomplete="off"
        />
      </div>

      <div class="field">
        <label class="field__label" for="account-type">
          Account Type <span aria-hidden="true">*</span>
        </label>
        <select id="account-type" class="field__select" bind:value={formType}>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="credit">Credit Card</option>
          <option value="investment">Investment</option>
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="account-balance">
          {isEditMode ? 'Current Balance' : 'Starting Balance'}
          <span aria-hidden="true">*</span>
        </label>
        <div class="field__prefix-wrap">
          <span class="field__prefix" aria-hidden="true">$</span>
          <input
            id="account-balance"
            class="field__input field__input--prefixed"
            type="number"
            step="0.01"
            bind:value={formBalance}
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <footer class="dialog__footer">
        <button
          class="btn btn--ghost"
          type="button"
          onclick={closeForm}
          disabled={saving}
        >
          Cancel
        </button>
        <button class="btn btn--primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Add Account'}
        </button>
      </footer>
    </form>
  </dialog>
{/if}

<!-- ── Delete confirmation dialog ────────────────────────────────────────── -->
{#if confirmDeleteId !== null}
  <dialog
    use:useModal={{ onClose: () => (confirmDeleteId = null) }}
    class="dialog dialog--sm"
    aria-modal="true"
    aria-labelledby="confirm-title"
  >
    <header class="dialog__header">
      <h2 class="dialog__title" id="confirm-title">Delete Account?</h2>
    </header>
    <div class="dialog__body">
      <p class="dialog__text">
        Are you sure you want to delete
        <strong>{confirmDeleteTarget?.name ?? 'this account'}</strong>?
        This action cannot be undone.
      </p>
    </div>
    <footer class="dialog__footer">
      <button
        class="btn btn--ghost"
        onclick={() => (confirmDeleteId = null)}
      >
        Cancel
      </button>
      <button
        class="btn btn--danger"
        onclick={() => {
          if (confirmDeleteId) {
            deleteAccount(confirmDeleteId).catch(() => {
              ctx?.notify.error('Failed to delete account.');
            });
          }
        }}
      >
        Delete
      </button>
    </footer>
  </dialog>
{/if}

<style>
  /* ── Layout ──────────────────────────────────────────────────────────────── */
  .accounts-page {
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
    height: 5rem;
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

  /* ── Account list ────────────────────────────────────────────────────────── */
  .account-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
  }

  .account-card {
    display: flex;
    align-items: center;
    gap: var(--space-4, 1rem);
    padding: var(--space-4, 1rem) var(--space-5, 1.25rem);
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    transition: box-shadow 0.15s ease;
  }

  .account-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .account-card__icon {
    font-size: 1.75rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .account-card__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .account-card__name {
    font-weight: 600;
    color: var(--color-text, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-card__institution {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #6b7280);
  }

  .account-card__type {
    font-size: 0.75rem;
    color: var(--color-text-subtle, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .account-card__balance {
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--color-text, #111827);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .account-card__balance--negative {
    color: var(--color-danger, #dc2626);
  }

  .account-card__actions {
    display: flex;
    gap: var(--space-2, 0.5rem);
    flex-shrink: 0;
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

  .field__prefix-wrap {
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

  .field__input--prefixed {
    padding-left: var(--space-6, 1.5rem);
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
