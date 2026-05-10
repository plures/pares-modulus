/**
 * Core types for netops-toolkit plugin
 */

// Device inventory
export interface Device {
  id: string;
  name: string;
  host: string;
  vendor: 'cisco_ios' | 'nokia_sros' | 'arista_eos';
  model: string;
  version: string;
  serial: string;
  site: string;
}

// Scan types
export interface ScanConfig {
  subnet: string;
  csvPath?: string;
  username: string;
  password: string;
  deepScan: boolean;
  concurrency: number;
}

export interface ScanState {
  status: 'idle' | 'running' | 'complete' | 'error';
  scanned: number;
  total: number;
  devices: Device[];
  startedAt: number | null;
  elapsedMs: number;
  error: string | null;
}

// Health types
export interface DeviceHealthEntry {
  hostname: string;
  status: 'healthy' | 'warning' | 'critical' | 'unreachable';
  cpuPercent: number;
  memoryPercent: number;
  interfaceErrors: InterfaceError[];
  logAlerts: LogAlertEntry[];
}

export interface InterfaceError {
  interfaceName: string;
  crcErrors: number;
  inputErrors: number;
  outputErrors: number;
}

export interface LogAlertEntry {
  timestamp: string;
  severity: string;
  source: string;
  message: string;
}

export interface FleetHealth {
  summary: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    unreachable: number;
  };
  devices: DeviceHealthEntry[];
  vendorBreakdown: Array<{
    vendor: string;
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    unreachable: number;
    avgCpu: number;
    avgMemory: number;
  }>;
  lastUpdated: string;
}

// Config types
export interface ConfigBackup {
  hostname: string;
  version: string;
  timestamp: string;
  size: number;
}

// Vault types
export type CredentialScope = 'default' | 'group' | 'device';
export type AuthMethod = 'password' | 'key';

export interface VaultCredential {
  id: string;
  scope: CredentialScope;
  target?: string;
  username: string;
  authMethod: AuthMethod;
  hasEnableSecret: boolean;
}

export interface VaultSetPayload {
  vaultType: 'personal';
  scope: CredentialScope;
  target?: string;
  username: string;
  password?: string;
  enableSecret?: string;
  authMethod: AuthMethod;
}
