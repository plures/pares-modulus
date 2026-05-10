<script lang="ts">
	import {
		Table,
		Badge,
		StatusBar,
		StatusBarItem,
		StatusBarSpacer,
		Button,
	} from '@plures/design-dojo';
	import { getFleetHealth, saveFleetHealth } from '../lib/store.js';
	import type { FleetHealth, DeviceHealthEntry } from '../lib/types.js';

	// Mock health data
	const mockFleetHealth: FleetHealth = {
		summary: {
			total: 12,
			healthy: 8,
			warning: 3,
			critical: 1,
			unreachable: 0
		},
		devices: [
			{
				hostname: 'core-rtr-01',
				status: 'healthy',
				cpuPercent: 45,
				memoryPercent: 62,
				interfaceErrors: [],
				logAlerts: []
			},
			{
				hostname: 'core-rtr-02',
				status: 'warning',
				cpuPercent: 78,
				memoryPercent: 85,
				interfaceErrors: [
					{ interfaceName: 'Gi0/1', crcErrors: 12, inputErrors: 5, outputErrors: 3 }
				],
				logAlerts: []
			},
			{
				hostname: 'edge-sw-01',
				status: 'critical',
				cpuPercent: 92,
				memoryPercent: 95,
				interfaceErrors: [
					{ interfaceName: 'Eth1/1', crcErrors: 45, inputErrors: 18, outputErrors: 12 }
				],
				logAlerts: [
					{
						timestamp: new Date().toISOString(),
						severity: 'critical',
						source: 'edge-sw-01',
						message: 'High memory utilization detected'
					}
				]
			}
		],
		vendorBreakdown: [
			{
				vendor: 'Cisco',
				total: 6,
				healthy: 4,
				warning: 2,
				critical: 0,
				unreachable: 0,
				avgCpu: 52,
				avgMemory: 68
			},
			{
				vendor: 'Nokia',
				total: 4,
				healthy: 3,
				warning: 1,
				critical: 0,
				unreachable: 0,
				avgCpu: 48,
				avgMemory: 61
			},
			{
				vendor: 'Arista',
				total: 2,
				healthy: 1,
				warning: 0,
				critical: 1,
				unreachable: 0,
				avgCpu: 85,
				avgMemory: 88
			}
		],
		lastUpdated: new Date().toISOString()
	};

	let fleetHealth = $state<FleetHealth>(getFleetHealth() ?? mockFleetHealth);
	let loading = $state(false);
	let autoRefresh = $state(false);
	let refreshInterval = $state(30);

	let summary = $derived(fleetHealth.summary);

	let topCpuDevices = $derived(
		[...fleetHealth.devices]
			.filter((d) => d.status !== 'unreachable')
			.sort((a, b) => b.cpuPercent - a.cpuPercent)
			.slice(0, 5)
	);

	let topMemoryDevices = $derived(
		[...fleetHealth.devices]
			.filter((d) => d.status !== 'unreachable')
			.sort((a, b) => b.memoryPercent - a.memoryPercent)
			.slice(0, 5)
	);

	let vendorRows = $derived(
		fleetHealth.vendorBreakdown.map((v) => ({
			vendor: v.vendor,
			total: String(v.total),
			healthy: String(v.healthy),
			warning: String(v.warning),
			critical: String(v.critical),
			avgCpu: `${v.avgCpu}%`,
			avgMemory: `${v.avgMemory}%`
		}))
	);

	let lastUpdatedFormatted = $derived(
		new Date(fleetHealth.lastUpdated).toLocaleString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		})
	);

	function statusVariant(
		status: DeviceHealthEntry['status']
	): 'success' | 'warning' | 'danger' | 'neutral' {
		if (status === 'healthy') return 'success';
		if (status === 'warning') return 'warning';
		if (status === 'critical') return 'danger';
		return 'neutral';
	}

	function thresholdClass(pct: number): string {
		if (pct >= 90) return 'threshold-red';
		if (pct >= 70) return 'threshold-yellow';
		return 'threshold-green';
	}

	async function refreshData(): Promise<void> {
		loading = true;
		try {
			// In real implementation, fetch from backend
			await new Promise(resolve => setTimeout(resolve, 500));
			fleetHealth.lastUpdated = new Date().toISOString();
			saveFleetHealth(fleetHealth);
		} finally {
			loading = false;
		}
	}

	const vendorColumns = [
		{ key: 'vendor', label: 'Vendor', width: 10 },
		{ key: 'total', label: 'Total', width: 6 },
		{ key: 'healthy', label: 'Healthy', width: 8 },
		{ key: 'warning', label: 'Warning', width: 8 },
		{ key: 'critical', label: 'Critical', width: 8 },
		{ key: 'avgCpu', label: 'Avg CPU', width: 8 },
		{ key: 'avgMemory', label: 'Avg Mem', width: 8 }
	];
</script>

<div class="health-page">
	<div class="toolbar">
		<h2 class="page-title">Health Dashboard</h2>
		<div class="toolbar-actions">
			<Button variant="solid" size="sm" onclick={refreshData} disabled={loading}>
				{loading ? 'Refreshing…' : '🔄 Refresh'}
			</Button>
		</div>
	</div>

	<section class="overview-grid">
		<div class="card">
			<span class="card-label">Total</span>
			<span class="card-value">{summary.total}</span>
		</div>
		<div class="card card-healthy">
			<span class="card-label">Healthy</span>
			<span class="card-value">{summary.healthy}</span>
		</div>
		<div class="card card-warning">
			<span class="card-label">Warning</span>
			<span class="card-value">{summary.warning}</span>
		</div>
		<div class="card card-critical">
			<span class="card-label">Critical</span>
			<span class="card-value">{summary.critical}</span>
		</div>
		<div class="card card-unreachable">
			<span class="card-label">Unreachable</span>
			<span class="card-value">{summary.unreachable}</span>
		</div>
	</section>

	<div class="dashboard-body">
		<section class="gauge-section">
			<h3 class="section-title">Top CPU Consumers</h3>
			<div class="gauge-list">
				{#each topCpuDevices as device}
					<div class="gauge-row">
						<span class="gauge-hostname">{device.hostname}</span>
						<div class="gauge-bar {thresholdClass(device.cpuPercent)}">
							<div class="gauge-fill" style="width: {device.cpuPercent}%"></div>
						</div>
						<Badge variant={statusVariant(device.status)} size="sm">
							{device.status}
						</Badge>
					</div>
				{/each}
			</div>
		</section>

		<section class="gauge-section">
			<h3 class="section-title">Top Memory Consumers</h3>
			<div class="gauge-list">
				{#each topMemoryDevices as device}
					<div class="gauge-row">
						<span class="gauge-hostname">{device.hostname}</span>
						<div class="gauge-bar {thresholdClass(device.memoryPercent)}">
							<div class="gauge-fill" style="width: {device.memoryPercent}%"></div>
						</div>
						<Badge variant={statusVariant(device.status)} size="sm">
							{device.status}
						</Badge>
					</div>
				{/each}
			</div>
		</section>

		<section class="table-section">
			<h3 class="section-title">Vendor Breakdown</h3>
			<div class="table-wrapper">
				<Table
					columns={vendorColumns}
					rows={vendorRows}
				/>
			</div>
		</section>
	</div>

	<StatusBar position="bottom">
		<StatusBarItem label="Devices" value={String(summary.total)} />
		<StatusBarItem
			label="Healthy"
			value={String(summary.healthy)}
			color="success"
			separator
		/>
		<StatusBarSpacer />
		<StatusBarItem label="Updated" value={lastUpdatedFormatted} />
	</StatusBar>
</div>

<style>
	.health-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
		flex-shrink: 0;
	}

	.page-title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.overview-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 12px;
		padding: 12px 16px;
		flex-shrink: 0;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 12px;
		border-radius: 6px;
	}

	.card-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.card-value {
		font-size: 1.5rem;
		font-weight: 700;
	}

	.card-healthy .card-value { color: #a6e3a1; }
	.card-warning .card-value { color: #f9e2af; }
	.card-critical .card-value { color: #f38ba8; }
	.card-unreachable .card-value { color: #a6adc8; }

	.dashboard-body {
		flex: 1;
		overflow: auto;
		padding: 0 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.section-title {
		margin: 0 0 8px;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.gauge-section {
		flex-shrink: 0;
	}

	.gauge-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.gauge-row {
		display: grid;
		grid-template-columns: 140px 1fr auto;
		align-items: center;
		gap: 12px;
	}

	.gauge-hostname {
		font-size: 0.8125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.gauge-bar {
		min-width: 0;
		height: 24px;
		border-radius: 4px;
		overflow: hidden;
	}

	.gauge-fill {
		height: 100%;
		transition: width 0.3s;
	}

	.threshold-green .gauge-fill { background: #a6e3a1; }
	.threshold-yellow .gauge-fill { background: #f9e2af; }
	.threshold-red .gauge-fill { background: #f38ba8; }

	.table-section {
		flex-shrink: 0;
	}

	.table-wrapper {
		max-height: 300px;
		overflow: auto;
		border-radius: 6px;
	}
</style>
