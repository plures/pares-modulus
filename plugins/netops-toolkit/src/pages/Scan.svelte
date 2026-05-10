<script lang="ts">
	import { Button } from '@plures/design-dojo';
	import type { ScanConfig, ScanState, Device } from '../lib/types.js';
	import { saveInventory, setLastScanTime } from '../lib/store.js';

	let config: ScanConfig = $state({
		subnet: '10.0.0.0/24',
		csvPath: '',
		username: 'admin',
		password: '',
		deepScan: false,
		concurrency: 10
	});

	let scan: ScanState = $state({
		status: 'idle',
		scanned: 0,
		total: 0,
		devices: [],
		startedAt: null,
		elapsedMs: 0,
		error: null
	});

	const subnetPattern = String.raw`^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$`;

	let elapsedInterval: ReturnType<typeof setInterval> | null = null;
	let scanInterval: ReturnType<typeof setInterval> | null = null;

	let progressPct = $derived(scan.total > 0 ? (scan.scanned / scan.total) * 100 : 0);
	let elapsedLabel = $derived(formatElapsed(scan.elapsedMs));

	function formatElapsed(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		const mins = Math.floor(totalSec / 60);
		const secs = totalSec % 60;
		return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
	}

	function generateMockDevices(count: number): Device[] {
		const vendors = ['cisco_ios', 'nokia_sros', 'arista_eos'] as const;
		const versions = ['16.9.4', '23.10.R1', '4.28.0F'];
		const models = ['ISR4331', '7750 SR-7', 'DCS-7050TX'];
		const sites = ['DC-01', 'DC-02', 'Branch-A'];
		const [base] = (config.subnet || '10.0.0.0/24').split('/');
		const parts = base.split('.');

		return Array.from({ length: count }, (_, i) => {
			const vi = i % vendors.length;
			return {
				id: `dev-${i}`,
				name: `${vendors[vi].substring(0, 2)}-${String(i + 1).padStart(3, '0')}`,
				host: `${parts[0]}.${parts[1]}.${parts[2]}.${i + 1}`,
				vendor: vendors[vi],
				version: versions[vi],
				model: models[vi],
				serial: `SN${String(1000 + i).padStart(8, '0')}`,
				site: sites[i % sites.length]
			};
		});
	}

	function startScan() {
		if (scan.status === 'running') return;

		const rawPrefix = (config.subnet || '').split('/')[1] ?? '';
		let prefix = Number.parseInt(rawPrefix, 10);

		if (Number.isNaN(prefix)) prefix = 24;
		if (prefix < 0) prefix = 0;
		if (prefix > 32) prefix = 32;

		if (prefix >= 31) {
			scan.status = 'error';
			scan.error = 'Subnets with /31 or /32 prefixes are not supported.';
			scan.scanned = 0;
			scan.total = 0;
			scan.devices = [];
			scan.startedAt = null;
			scan.elapsedMs = 0;
			return;
		}

		const totalHosts = Math.pow(2, 32 - prefix) - 2;
		const total = Math.min(totalHosts, 254);
		const allDevices = generateMockDevices(Math.max(1, Math.floor(total * 0.35)));

		scan = {
			status: 'running',
			scanned: 0,
			total,
			devices: [],
			startedAt: Date.now(),
			elapsedMs: 0,
			error: null
		};

		elapsedInterval = setInterval(() => {
			if (scan.startedAt !== null) {
				scan.elapsedMs = Date.now() - scan.startedAt;
			}
		}, 500);

		const step = Math.max(1, Math.floor(config.concurrency * 0.8));
		let deviceIdx = 0;

		scanInterval = setInterval(() => {
			const next = Math.min(scan.scanned + step, scan.total);
			const newDevices: Device[] = [];

			while (deviceIdx < allDevices.length && deviceIdx < next * 0.35) {
				newDevices.push(allDevices[deviceIdx]);
				deviceIdx++;
			}

			scan.scanned = next;
			if (newDevices.length) {
				scan.devices = [...scan.devices, ...newDevices];
			}

			if (next >= scan.total) {
				finishScan();
			}
		}, 300);
	}

	function finishScan() {
		clearInterval(scanInterval!);
		clearInterval(elapsedInterval!);
		scanInterval = null;
		elapsedInterval = null;
		if (scan.startedAt !== null) {
			scan.elapsedMs = Date.now() - scan.startedAt;
		}
		scan.status = 'complete';
		
		// Save to store
		saveInventory(scan.devices);
		setLastScanTime(Date.now());
	}

	function resetScan() {
		clearInterval(scanInterval!);
		clearInterval(elapsedInterval!);
		scanInterval = null;
		elapsedInterval = null;
		scan = {
			status: 'idle',
			scanned: 0,
			total: 0,
			devices: [],
			startedAt: null,
			elapsedMs: 0,
			error: null
		};
	}
</script>

<div class="scan-page">
	<header class="scan-page__header">
		<h1>Scan Runner</h1>
		<p class="scan-page__subtitle">Launch a network scan and monitor live progress.</p>
	</header>

	<section class="card" aria-labelledby="config-heading">
		<h2 id="config-heading" class="card__title">Scan Configuration</h2>

		<form
			class="config-form"
			onsubmit={(e) => {
				e.preventDefault();
				startScan();
			}}
		>
			<div class="form-row">
				<label class="form-label" for="subnet">Subnet (CIDR)</label>
				<input
					id="subnet"
					class="form-input"
					type="text"
					bind:value={config.subnet}
					placeholder="10.0.0.0/24"
					pattern={subnetPattern}
					disabled={scan.status === 'running'}
					required
				/>
			</div>

			<div class="form-row">
				<label class="form-label" for="concurrency">
					Concurrency
					<span class="form-label__value">{config.concurrency}</span>
				</label>
				<input
					id="concurrency"
					class="form-range"
					type="range"
					min={1}
					max={50}
					bind:value={config.concurrency}
					disabled={scan.status === 'running'}
				/>
			</div>

			<div class="form-actions">
				{#if scan.status === 'idle' || scan.status === 'complete' || scan.status === 'error'}
					<Button variant="solid" type="submit">
						▶ Start Scan
					</Button>
				{:else}
					<Button variant="danger" type="button" onclick={resetScan}>
						■ Cancel
					</Button>
				{/if}
			</div>
		</form>
	</section>

	{#if scan.status !== 'idle'}
		<section class="card" aria-labelledby="progress-heading" aria-live="polite">
			<h2 id="progress-heading" class="card__title">
				{#if scan.status === 'running'}
					Scanning…
				{:else if scan.status === 'complete'}
					Scan Complete
				{:else}
					Scan Error
				{/if}
			</h2>

			<div class="progress-row">
				<div class="progress-bar">
					<div class="progress-fill" style="width: {progressPct}%"></div>
				</div>
				<span class="progress-count">
					{scan.scanned}/{scan.total}
				</span>
			</div>

			<dl class="scan-stats">
				<div class="scan-stats__item">
					<dt>Devices found</dt>
					<dd>{scan.devices.length}</dd>
				</div>
				<div class="scan-stats__item">
					<dt>Elapsed</dt>
					<dd>{elapsedLabel}</dd>
				</div>
			</dl>

			{#if scan.status === 'complete'}
				<div class="scan-complete-banner" role="status">
					<strong>Scan finished</strong> — {scan.devices.length} device{scan.devices.length === 1
						? ''
						: 's'} discovered in {elapsedLabel}.
				</div>
			{/if}
		</section>
	{/if}

	{#if scan.devices.length > 0}
		<section class="card">
			<h2 class="card__title">
				Live Results
				<span class="badge">{scan.devices.length} found</span>
			</h2>

			<div class="table-wrap">
				<table class="results-table">
					<thead>
						<tr>
							<th>Hostname</th>
							<th>IP Address</th>
							<th>Vendor</th>
							<th>Model</th>
						</tr>
					</thead>
					<tbody>
						{#each scan.devices as device (device.id)}
							<tr>
								<td>{device.name}</td>
								<td>{device.host}</td>
								<td>{device.vendor}</td>
								<td>{device.model}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>

<style>
	.scan-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.scan-page__header h1 {
		margin: 0 0 4px;
		font-size: 1.5rem;
		font-weight: 700;
	}

	.scan-page__subtitle {
		margin: 0;
		font-size: 0.875rem;
	}

	.card {
		border-radius: 8px;
		padding: 24px;
	}

	.card__title {
		margin: 0 0 24px;
		font-size: 1rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.config-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.form-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-label {
		font-size: 0.8125rem;
		font-weight: 500;
		display: flex;
		gap: 8px;
		align-items: baseline;
	}

	.form-input {
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 0.875rem;
		outline: none;
	}

	.form-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.form-range {
		width: 100%;
		cursor: pointer;
	}

	.form-actions {
		display: flex;
		gap: 12px;
		padding-top: 8px;
	}

	.progress-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
	}

	.progress-bar {
		flex: 1;
		height: 24px;
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		transition: width 0.3s;
	}

	.progress-count {
		font-family: monospace;
		font-size: 0.875rem;
		min-width: 7ch;
		text-align: right;
	}

	.scan-stats {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		margin: 0 0 16px;
		padding: 0;
	}

	.scan-stats__item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.scan-stats__item dt {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.scan-stats__item dd {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
	}

	.scan-complete-banner {
		padding: 16px;
		border-radius: 6px;
		font-size: 0.875rem;
	}

	.badge {
		font-size: 0.75rem;
		font-weight: 700;
		border-radius: 12px;
		padding: 1px 8px;
	}

	.table-wrap {
		overflow-x: auto;
		border-radius: 6px;
	}

	.results-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.results-table th {
		padding: 8px 12px;
		text-align: left;
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
	}

	.results-table td {
		padding: 8px 12px;
	}
</style>
