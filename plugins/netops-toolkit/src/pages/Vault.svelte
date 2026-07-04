<script lang="ts">
	import {
		Table,
		Button,
		Badge,
		SearchInput,
		StatusBar,
		StatusBarItem,
		StatusBarSpacer
	} from '@plures/design-dojo';
	import type { SearchResult } from '@plures/design-dojo';
	import type {
		AuthMethod,
		CredentialScope,
		VaultCredential
	} from '../lib/types.js';
	import { getVaultCredentials, saveVaultCredentials, deleteVaultCredential } from '../lib/store.js';

	// Mock credentials
	const mockCredentials: VaultCredential[] = [
		{
			id: 'cred-1',
			scope: 'default',
			username: 'admin',
			authMethod: 'password',
			hasEnableSecret: true
		},
		{
			id: 'cred-2',
			scope: 'group',
			target: 'core-*',
			username: 'netadmin',
			authMethod: 'key',
			hasEnableSecret: false
		},
		{
			id: 'cred-3',
			scope: 'device',
			target: 'edge-sw-01',
			username: 'edgeadmin',
			authMethod: 'password',
			hasEnableSecret: true
		}
	];

	type VaultView = 'list' | 'form' | 'delete';

	let view = $state<VaultView>('list');
	let credentials = $state<VaultCredential[]>(
		getVaultCredentials().length > 0 ? getVaultCredentials() : mockCredentials
	);
	let loading = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let searchQuery = $state('');
	let selectedIndex = $state<number | undefined>(undefined);

	const columns = [
		{ key: 'scope', label: 'Scope', width: 10 },
		{ key: 'target', label: 'Target', width: 22 },
		{ key: 'username', label: 'Username', width: 16 },
		{ key: 'authMethod', label: 'Auth', width: 10 },
		{ key: 'enableSecret', label: 'Enable', width: 8 }
	];

	let filteredCredentials = $derived.by(() => {
		if (!searchQuery.trim()) return credentials;
		const q = searchQuery.toLowerCase();
		return credentials.filter(
			(c) =>
				c.scope.toLowerCase().includes(q) ||
				(c.target ?? '').toLowerCase().includes(q) ||
				c.username.toLowerCase().includes(q)
		);
	});

	let rows = $derived(
		filteredCredentials.map((c) => ({
			scope: c.scope,
			target: c.target ?? '(any)',
			username: c.username,
			authMethod: c.authMethod,
			enableSecret: c.hasEnableSecret ? 'yes' : 'no'
		}))
	);

	function handleSelectRow(index: number): void {
		selectedIndex = index;
		const cred = filteredCredentials[index];
		if (cred) openEditForm(cred);
	}

	async function handleSearch(query: string): Promise<SearchResult[]> {
		searchQuery = query;
		if (!query) return [];
		const q = query.toLowerCase();
		return filteredCredentials
			.filter(
				(c) =>
					c.scope.toLowerCase().includes(q) ||
					(c.target ?? '').toLowerCase().includes(q) ||
					c.username.toLowerCase().includes(q)
			)
			.slice(0, 8)
			.map((c) => ({
				id: c.id,
				text: c.target ? `${c.scope}: ${c.target} (${c.username})` : `default (${c.username})`,
				score: 1
			}));
	}

	function handleSearchSelect(result: SearchResult): void {
		const index = filteredCredentials.findIndex((c) => c.id === result.id);
		if (index >= 0) handleSelectRow(index);
	}

	// Form state
	let editingId = $state<string | null>(null);
	let formScope = $state<CredentialScope>('default');
	let formTarget = $state('');
	let formUsername = $state('');
	let formEnableSecret = $state('');
	let formAuthMethod = $state<AuthMethod>('password');

	function openAddForm(): void {
		editingId = null;
		formScope = 'default';
		formTarget = '';
		formUsername = '';
		formEnableSecret = '';
		formAuthMethod = 'password';
		errorMsg = '';
		view = 'form';
	}

	function openEditForm(cred: VaultCredential): void {
		editingId = cred.id;
		formScope = cred.scope;
		formTarget = cred.target ?? '';
		formUsername = cred.username;
		formEnableSecret = '';
		formAuthMethod = cred.authMethod;
		errorMsg = '';
		view = 'form';
	}

	async function handleSaveCredential(): Promise<void> {
		if (!formUsername.trim()) {
			errorMsg = 'Username is required.';
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const saved: VaultCredential = editingId
				? { ...credentials.find(c => c.id === editingId)!, username: formUsername.trim(), authMethod: formAuthMethod }
				: {
						id: `cred-${Date.now()}`,
						scope: formScope,
						target: formTarget.trim() || undefined,
						username: formUsername.trim(),
						authMethod: formAuthMethod,
						hasEnableSecret: !!formEnableSecret
					};
			
			if (editingId) {
				const idx = credentials.findIndex((c) => c.id === editingId);
				if (idx >= 0) credentials[idx] = saved;
			} else {
				credentials.push(saved);
			}
			
			saveVaultCredentials(credentials);
			successMsg = editingId ? 'Credential updated.' : 'Credential added.';
			view = 'list';
		} finally {
			formEnableSecret = '';
			loading = false;
		}
	}

	let deletingId = $state<string | null>(null);

	function openDeleteConfirm(cred: VaultCredential): void {
		deletingId = cred.id;
		errorMsg = '';
		view = 'delete';
	}

	async function handleConfirmDelete(): Promise<void> {
		if (!deletingId) return;
		loading = true;
		errorMsg = '';
		try {
			deleteVaultCredential(deletingId);
			credentials = credentials.filter((c) => c.id !== deletingId);
			deletingId = null;
			successMsg = 'Credential deleted.';
			view = 'list';
		} finally {
			loading = false;
		}
	}

	function scopeVariant(scope: CredentialScope): 'success' | 'warning' | 'neutral' {
		if (scope === 'device') return 'success';
		if (scope === 'group') return 'warning';
		return 'neutral';
	}
</script>

<div class="vault-page">
	{#if view === 'list'}
		<div class="toolbar">
			<h2>Credential Vault</h2>
			<div class="toolbar-actions">
				<SearchInput
					placeholder="Search credentials…"
					onSearch={handleSearch}
					onSelect={handleSearchSelect}
					cols={28}
				/>
				<Button variant="solid" onclick={openAddForm}>＋ Add Credential</Button>
			</div>
		</div>

		{#if successMsg}
			<div class="banner success" role="status">{successMsg}</div>
		{/if}

		<div class="table-container">
			<Table
				{columns}
				{rows}
				selected={selectedIndex}
				onselect={handleSelectRow}
			/>
		</div>

		<div class="row-actions">
			{#each filteredCredentials as cred}
				<div class="row-action-item">
					<Badge variant={scopeVariant(cred.scope)} size="sm">{cred.scope}</Badge>
					<span class="row-target">{cred.target ?? '(any)'}</span>
					<div class="row-btns">
						<Button size="sm" variant="ghost" onclick={() => openEditForm(cred)}>✏️ Edit</Button>
						<Button size="sm" variant="ghost" onclick={() => openDeleteConfirm(cred)}>🗑 Delete</Button>
					</div>
				</div>
			{/each}
		</div>

		<StatusBar>
			<StatusBarItem label="Credentials" value={String(filteredCredentials.length)} />
			<StatusBarSpacer />
			<StatusBarItem label="View" value="Credential Vault" />
		</StatusBar>

	{:else if view === 'form'}
		<div class="toolbar">
			<h2>{editingId ? 'Edit Credential' : 'Add Credential'}</h2>
			<div class="toolbar-actions">
				<Button
					variant="ghost"
					onclick={() => {
						view = 'list';
						errorMsg = '';
					}}
				>
					← Back
				</Button>
			</div>
		</div>

		<div class="form-card">
			<div class="field">
				<label for="form-scope">Scope</label>
				<select id="form-scope" bind:value={formScope} class="select-input">
					<option value="default">default — catch-all fallback</option>
					<option value="group">group — hostname/IP pattern</option>
					<option value="device">device — specific hostname</option>
				</select>
			</div>

			{#if formScope === 'group' || formScope === 'device'}
				<div class="field">
					<label for="form-target">
						{formScope === 'group' ? 'Pattern (e.g. 10.0.1.* or core-*)' : 'Hostname / IP'}
					</label>
					<input
						id="form-target"
						type="text"
						bind:value={formTarget}
						placeholder={formScope === 'group' ? '10.0.1.*' : 'core-rtr-01'}
						class="text-input"
					/>
				</div>
			{/if}

			<div class="field">
				<label for="form-username">Username</label>
				<input
					id="form-username"
					type="text"
					bind:value={formUsername}
					placeholder="admin"
					class="text-input"
				/>
			</div>

			<div class="field">
				<label for="form-auth">Auth method</label>
				<select
					id="form-auth"
					bind:value={formAuthMethod}
					class="select-input"
				>
					<option value="password">password</option>
					<option value="key">SSH key</option>
				</select>
			</div>

			{#if errorMsg}<p class="error-msg" role="alert">{errorMsg}</p>{/if}

			<div class="form-actions">
				<Button variant="solid" onclick={handleSaveCredential} disabled={loading}>
					{loading ? 'Saving…' : editingId ? 'Update' : 'Add Credential'}
				</Button>
				<Button
					variant="outline"
					onclick={() => {
						view = 'list';
						errorMsg = '';
					}}
				>
					Cancel
				</Button>
			</div>
		</div>

	{:else if view === 'delete'}
		<div class="toolbar">
			<h2>Delete Credential</h2>
		</div>

		<div class="form-card">
			<p class="delete-warning" role="alert">
				Are you sure you want to delete this credential?
			</p>
			<div class="form-actions">
				<Button variant="solid" onclick={handleConfirmDelete} disabled={loading}>
					{loading ? 'Deleting…' : 'Yes, Delete'}
				</Button>
				<Button
					variant="outline"
					onclick={() => {
						view = 'list';
						deletingId = null;
					}}
				>
					Cancel
				</Button>
			</div>
		</div>
	{/if}
</div>

<style>
	.vault-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		flex-shrink: 0;
	}

	.toolbar h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.banner.success {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.table-container {
		flex: 1;
		overflow: auto;
		min-height: 0;
	}

	.row-actions {
		padding: 0.5rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 200px;
		overflow-y: auto;
		flex-shrink: 0;
	}

	.row-action-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.row-target {
		flex: 1;
		font-family: monospace;
		font-size: 0.8125rem;
	}

	.row-btns {
		display: flex;
		gap: 0.25rem;
	}

	.form-card {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 560px;
		overflow-y: auto;
		flex: 1;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.field label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.text-input {
		padding: 0.5rem 0.75rem;
		border-radius: 4px;
		font-size: 0.9375rem;
		width: 100%;
		box-sizing: border-box;
	}

	.select-input {
		padding: 0.5rem 0.75rem;
		border-radius: 4px;
		font-size: 0.9375rem;
		width: 100%;
		box-sizing: border-box;
	}

	.error-msg {
		margin: 0;
		font-size: 0.875rem;
	}

	.form-actions {
		display: flex;
		gap: 0.5rem;
	}

	.delete-warning {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
</style>
