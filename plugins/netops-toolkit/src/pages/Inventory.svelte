<script lang="ts">
	import {
		Table,
		SearchInput,
		SplitPane,
		Pane,
		StatusBar,
		StatusBarItem,
		StatusBarSpacer,
		Badge,
		Button,
	} from '@plures/design-dojo';
	import type { SearchResult } from '@plures/design-dojo';
	import { getInventory, getLastScanTime } from '../lib/store.js';
	import type { Device } from '../lib/types.js';

	// --- Vendor filter state ---
	type VendorFilter = 'all' | 'cisco_ios' | 'nokia_sros' | 'arista_eos';
	let vendorFilter = $state<VendorFilter>('all');

	// --- Search state ---
	let searchQuery = $state('');

	// --- Row selection ---
	let selectedIndex = $state<number | undefined>(undefined);

	// --- Load inventory ---
	let devices = $state<Device[]>(getInventory());
	let lastScanTime = $state<number | null>(getLastScanTime());

	// --- Table columns ---
	const columns = [
		{ key: 'name', label: 'Name', width: 16 },
		{ key: 'host', label: 'Host', width: 14 },
		{ key: 'vendor', label: 'Vendor', width: 12 },
		{ key: 'model', label: 'Model', width: 18 },
		{ key: 'version', label: 'Version', width: 12 },
		{ key: 'serial', label: 'Serial', width: 14 },
		{ key: 'site', label: 'Site', width: 10 }
	];

	// --- Filtered rows ---
	let filteredDevices = $derived(
		devices.filter((d) => {
			const matchesVendor = vendorFilter === 'all' || d.vendor === vendorFilter;
			const q = searchQuery.toLowerCase();
			const matchesSearch =
				q === '' ||
				d.name.toLowerCase().includes(q) ||
				d.host.toLowerCase().includes(q) ||
				d.model.toLowerCase().includes(q) ||
				d.site.toLowerCase().includes(q);
			return matchesVendor && matchesSearch;
		})
	);

	let tableRows = $derived(
		filteredDevices.map((d) => ({
			name: d.name,
			host: d.host,
			vendor: vendorLabel(d.vendor),
			model: d.model,
			version: d.version,
			serial: d.serial,
			site: d.site
		}))
	);

	let selectedDevice = $derived<Device | undefined>(
		selectedIndex !== undefined && selectedIndex < filteredDevices.length
			? filteredDevices[selectedIndex]
			: undefined
	);

	// --- Vendor counts ---
	let vendorCounts = $derived({
		cisco_ios: devices.filter((d) => d.vendor === 'cisco_ios').length,
		nokia_sros: devices.filter((d) => d.vendor === 'nokia_sros').length,
		arista_eos: devices.filter((d) => d.vendor === 'arista_eos').length
	});

	function vendorLabel(v: Device['vendor']): string {
		const labels: Record<Device['vendor'], string> = {
			cisco_ios: 'Cisco IOS',
			nokia_sros: 'Nokia SR OS',
			arista_eos: 'Arista EOS'
		};
		return labels[v];
	}

	function vendorBadgeVariant(
		v: VendorFilter
	): 'accent' | 'info' | 'success' | 'neutral' {
		if (v === 'cisco_ios') return 'accent';
		if (v === 'nokia_sros') return 'info';
		if (v === 'arista_eos') return 'success';
		return 'neutral';
	}

	function handleRowSelect(index: number): void {
		selectedIndex = index;
	}

	// --- SearchInput handlers ---
	async function handleSearch(query: string): Promise<SearchResult[]> {
		searchQuery = query;
		if (!query) return [];
		const q = query.toLowerCase();
		return devices
			.filter(
				(d) =>
					d.name.toLowerCase().includes(q) ||
					d.host.toLowerCase().includes(q) ||
					d.site.toLowerCase().includes(q)
			)
			.slice(0, 8)
			.map((d) => ({
				text: `${d.name} (${d.host})`,
				score: 1,
				id: d.id,
				meta: { site: d.site }
			}));
	}

	function handleSearchSelect(item: SearchResult): void {
		const device = devices.find((d) => d.id === item.id);
		if (device) {
			const index = filteredDevices.findIndex((d) => d.id === item.id);
			if (index >= 0) selectedIndex = index;
		}
	}

	// --- Last scan formatting ---
	let lastScanFormatted = $derived(
		lastScanTime
			? new Date(lastScanTime).toLocaleString('en-GB', {
					day: '2-digit',
					month: 'short',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: 'Never'
	);
</script>

<div class="inventory-page">
	<!-- Toolbar: search + vendor filters -->
	<div class="toolbar" role="toolbar" aria-label="Inventory filters">
		<div class="search-wrapper">
			<SearchInput
				placeholder="Search devices…"
				onSearch={handleSearch}
				onSelect={handleSearchSelect}
				cols={40}
			/>
		</div>

		<div class="vendor-filters" role="group" aria-label="Filter by vendor">
			<Button
				variant={vendorFilter === 'all' ? 'solid' : 'ghost'}
				size="sm"
				onclick={() => { vendorFilter = 'all'; selectedIndex = undefined; }}
			>
				All ({devices.length})
			</Button>
			<Button
				variant={vendorFilter === 'cisco_ios' ? 'solid' : 'ghost'}
				size="sm"
				onclick={() => { vendorFilter = vendorFilter === 'cisco_ios' ? 'all' : 'cisco_ios'; selectedIndex = undefined; }}
			>
				<Badge variant={vendorBadgeVariant('cisco_ios')} size="sm">Cisco</Badge>
				({vendorCounts.cisco_ios})
			</Button>
			<Button
				variant={vendorFilter === 'nokia_sros' ? 'solid' : 'ghost'}
				size="sm"
				onclick={() => { vendorFilter = vendorFilter === 'nokia_sros' ? 'all' : 'nokia_sros'; selectedIndex = undefined; }}
			>
				<Badge variant={vendorBadgeVariant('nokia_sros')} size="sm">Nokia</Badge>
				({vendorCounts.nokia_sros})
			</Button>
			<Button
				variant={vendorFilter === 'arista_eos' ? 'solid' : 'ghost'}
				size="sm"
				onclick={() => { vendorFilter = vendorFilter === 'arista_eos' ? 'all' : 'arista_eos'; selectedIndex = undefined; }}
			>
				<Badge variant={vendorBadgeVariant('arista_eos')} size="sm">Arista</Badge>
				({vendorCounts.arista_eos})
			</Button>
		</div>
	</div>

	<!-- Table + detail panel -->
	<div class="content">
		{#if selectedDevice}
			<SplitPane direction="horizontal">
				<Pane flex={3} scrollable>
					<Table
						{columns}
						rows={tableRows}
						selected={selectedIndex}
						onselect={handleRowSelect}
					/>
				</Pane>
				<Pane flex={1} title="Device Detail" scrollable>
					<dl class="detail-list">
						<div class="detail-row">
							<dt>Name</dt>
							<dd>{selectedDevice.name}</dd>
						</div>
						<div class="detail-row">
							<dt>Host</dt>
							<dd>{selectedDevice.host}</dd>
						</div>
						<div class="detail-row">
							<dt>Vendor</dt>
							<dd>
								<Badge variant={vendorBadgeVariant(selectedDevice?.vendor ?? 'cisco_ios')}>
									{vendorLabel(selectedDevice?.vendor ?? 'cisco_ios')}
								</Badge>
							</dd>
						</div>
						<div class="detail-row">
							<dt>Model</dt>
							<dd>{selectedDevice.model}</dd>
						</div>
						<div class="detail-row">
							<dt>Version</dt>
							<dd>{selectedDevice.version}</dd>
						</div>
						<div class="detail-row">
							<dt>Serial</dt>
							<dd>{selectedDevice.serial}</dd>
						</div>
						<div class="detail-row">
							<dt>Site</dt>
							<dd>{selectedDevice.site}</dd>
						</div>
					</dl>
					<div class="detail-close">
						<Button variant="ghost" size="sm" onclick={() => { selectedIndex = undefined; }}>
							✕ Close
						</Button>
					</div>
				</Pane>
			</SplitPane>
		{:else}
			<div class="table-wrapper">
				<Table
					{columns}
					rows={tableRows}
					selected={selectedIndex}
					onselect={handleRowSelect}
				/>
				{#if tableRows.length === 0}
					<p class="empty-state">No devices match the current filters.</p>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Status bar -->
	<StatusBar position="bottom">
		<StatusBarItem label="Devices" value={String(filteredDevices.length)} />
		{#if vendorFilter !== 'all'}
			<StatusBarItem
				label="Filter"
				value={vendorLabel(vendorFilter)}
				color="accent"
				separator
			/>
		{/if}
		<StatusBarSpacer />
		<StatusBarItem label="Last scan" value={lastScanFormatted} color="default" />
	</StatusBar>
</div>

<style>
	.inventory-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
		flex-shrink: 0;
	}

	.search-wrapper {
		flex: 0 0 auto;
	}

	.vendor-filters {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.content {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.table-wrapper {
		flex: 1;
		overflow: auto;
	}

	.empty-state {
		text-align: center;
		padding: 48px;
		font-size: 14px;
	}

	.detail-list {
		margin: 0;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.detail-row {
		display: flex;
		gap: 12px;
	}

	.detail-row dt {
		font-size: 14px;
		min-width: 60px;
		flex-shrink: 0;
	}

	.detail-row dd {
		margin: 0;
		font-size: 14px;
		display: flex;
		align-items: center;
	}

	.detail-close {
		padding: 8px 16px;
	}
</style>
