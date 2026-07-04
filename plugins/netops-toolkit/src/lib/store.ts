/**
 * Unified store for netops-toolkit plugin
 * 
 * Provides localStorage-backed reactive stores for inventory, scans, health, config backups, and vault.
 * Future: Replace with PluresDB collections when plugin data API is available.
 */

import type {
  Device,
  FleetHealth,
  ConfigBackup,
  VaultCredential,
} from './types';

// Storage keys
const STORAGE_KEYS = {
  inventory: 'netops_inventory',
  lastScan: 'netops_last_scan',
  health: 'netops_health',
  configBackups: 'netops_config_backups',
  vaultCredentials: 'netops_vault_credentials',
} as const;

// Generic localStorage helpers
function loadFromStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const data = window.localStorage.getItem(key);
    return data ? (JSON.parse(data) as T) : null;
  } catch (error) {
    console.error(`Failed to load ${key} from localStorage:`, error);
    return null;
  }
}

function saveToStorage<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`Failed to save ${key} to localStorage:`, error);
    throw new Error('Storage quota exceeded or localStorage is disabled');
  }
}

// Inventory operations
export function getInventory(): Device[] {
  return loadFromStorage<Device[]>(STORAGE_KEYS.inventory) ?? [];
}

export function saveInventory(devices: Device[]): void {
  saveToStorage(STORAGE_KEYS.inventory, devices);
}

export function addDevice(device: Device): Device {
  const devices = getInventory();
  const index = devices.findIndex(d => d.id === device.id);
  
  if (index >= 0) {
    devices[index] = device;
  } else {
    devices.push(device);
  }
  
  saveInventory(devices);
  return device;
}

export function deleteDevice(id: string): boolean {
  const devices = getInventory();
  const filtered = devices.filter(d => d.id !== id);
  saveInventory(filtered);
  return true;
}

// Scan state
export function getLastScanTime(): number | null {
  return loadFromStorage<number>(STORAGE_KEYS.lastScan);
}

export function setLastScanTime(timestamp: number): void {
  saveToStorage(STORAGE_KEYS.lastScan, timestamp);
}

// Health operations
export function getFleetHealth(): FleetHealth | null {
  return loadFromStorage<FleetHealth>(STORAGE_KEYS.health);
}

export function saveFleetHealth(health: FleetHealth): void {
  saveToStorage(STORAGE_KEYS.health, health);
}

// Config backup operations
export function getConfigBackups(): ConfigBackup[] {
  return loadFromStorage<ConfigBackup[]>(STORAGE_KEYS.configBackups) ?? [];
}

export function saveConfigBackups(backups: ConfigBackup[]): void {
  saveToStorage(STORAGE_KEYS.configBackups, backups);
}

export function addConfigBackup(backup: ConfigBackup): ConfigBackup {
  const backups = getConfigBackups();
  backups.push(backup);
  saveConfigBackups(backups);
  return backup;
}

// Vault operations
export function getVaultCredentials(): VaultCredential[] {
  return loadFromStorage<VaultCredential[]>(STORAGE_KEYS.vaultCredentials) ?? [];
}

export function saveVaultCredentials(credentials: VaultCredential[]): void {
  saveToStorage(STORAGE_KEYS.vaultCredentials, credentials);
}

export function addVaultCredential(credential: VaultCredential): VaultCredential {
  const credentials = getVaultCredentials();
  const index = credentials.findIndex(c => c.id === credential.id);
  
  if (index >= 0) {
    credentials[index] = credential;
  } else {
    credentials.push(credential);
  }
  
  saveVaultCredentials(credentials);
  return credential;
}

export function deleteVaultCredential(id: string): boolean {
  const credentials = getVaultCredentials();
  const filtered = credentials.filter(c => c.id !== id);
  saveVaultCredentials(filtered);
  return true;
}
