<script lang="ts">
	import { Table, Button, SearchInput, StatusBar, StatusBarItem, StatusBarSpacer } from '@plures/design-dojo';
	import type { SearchResult } from '@plures/design-dojo';
	import type { ConfigBackup } from '../lib/types.js';
	import { getConfigBackups, saveConfigBackups } from '../lib/store.js';

	// Mock backups
	const mockBackups: ConfigBackup[] = [
		{
			hostname: 'core-rtr-01',
			version: 'v2024.1',
			timestamp: new Date(Date.now() - 3600000).toISOString(),
			size: 12456
		},
		{
			hostname: 'core-rtr-02',
			version: 'v2024.1',
			timestamp: new Date(Date.now() - 7200000).toISOString(),
			size: 11234
		},
		{
			hostname: 'edge-sw-01',
			version: 'v2023.12',
			timestamp: new Date(Date.now() - 10800000).toISOString(),
			size: 8765
		}
	];

	let backups = $state<ConfigBackup[]>(getConfigBackups().length > 0 ? getConfigBackups() : mockBackups);
	let loading = $state(false);
	let searchQuery = $state('');
	let selectedIndex = $state<number | undefined>(undefined);

	const columns = [
		{ key: 'hostname', label: 'Device', width: 16 },
		{ key: 'version', label: 'Version', width: 10 },
		{ key: 'timestamp', label: 'Timestamp', width: 22 },
		{ key: 'size', label: 'Size', width: 10 }
	];

	let filteredBackups = $derived.by(() => {
		if (!searchQuery.trim()) return backups;
		const q = searchQuery.toLowerCase();
		return backups.filter(
			(b) =>
				b.hostname.toLowerCase().includes(q) ||
				b.version.toLowerCase().includes(q)
		);
	});

	let rows = $derived(
		filteredBackups.map((b) => ({
			hostname: b.hostname,
			version: b.version,
			timestamp: new Date(b.timestamp).toLocaleString(),
			size: formatSize(b.size)
		}))
	);

	let uniqueDevices = $derived(new Set(backups.map((b) => b.hostname)).size);

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	function handleSelect(index: number): void {
		selectedIndex = index;
	}

	async function handleCollectAll(): Promise<void> {
		loading = true;
		try {
			// Mock: add a new backup
			await new Promise(resolve => setTimeout(resolve, 500));
			const newBackup: ConfigBackup = {
				hostname: 'new-device-01',
				version: 'v2024.2',
				timestamp: new Date().toISOString(),
				size: 9876
			};
			backups = [...backups, newBackup];
			saveConfigBackups(backups);
		} finally {
			loading = false;
		}
	}

	async function handleSearch(query: string): Promise<SearchResult[]> {
		searchQuery = query;
		if (!query) return [];
		const q = query.toLowerCase();
		return filteredBackups
			.filter(
				(b) =>
					b.hostname.toLowerCase().includes(q) ||
					b.version.toLowerCase().includes(q)
			)
			.slice(0, 8)
			.map((b) => ({
				id: b.hostname,
				text: `${b.hostname} (${b.version})`,
				score: 1
			}));
	}

	function handleSearchSelect(result: SearchResult): void {
		const index = filteredBackups.findIndex((b) => b.hostname === result.id);
		if (index >= 0) handleSelect(index);
	}
</script>

<div class="config-page">
	<div class="toolbar">
		<h2>Config Backups</h2>
		<div class="toolbar-actions">
			<SearchInput
				placeholder="Search devices…"
				onSearch={handleSearch}
				onSelect={handleSearchSelect}
				cols={30}
			/>
			<Button variant="solid" onclick={handleCollectAll} disabled={loading}>
				{loading ? 'Collecting…' : '📥 Collect All'}
			</Button>
		</div>
	</div>

	<div class="table-container">
		<Table
			{columns}
			{rows}
			selected={selectedIndex}
			onselect={handleSelect}
		/>
	</div>

	<StatusBar>
		<StatusBarItem label="Backups" value={String(filteredBackups.length)} />
		<StatusBarItem label="Devices" value={String(uniqueDevices)} color="accent" separator />
		<StatusBarSpacer />
		<StatusBarItem label="View" value="Config Management" />
	</StatusBar>
</div>

<style>
	.config-page {
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

	.table-container {
		flex: 1;
		overflow: auto;
	}
</style>
