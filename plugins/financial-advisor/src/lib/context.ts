/**
 * Plugin context singleton for financial-advisor.
 *
 * `setPluginContext` is called from `onActivate` so that Svelte page
 * components can retrieve the PluresDB data API, notify API, etc.
 * without needing Svelte's own `setContext` / `getContext` mechanism
 * (which is scoped to component trees and unavailable in lifecycle hooks).
 */

import type { PluginContext } from '@plures/pares-radix';

let _context: PluginContext | null = null;

export function setPluginContext(ctx: PluginContext): void {
  _context = ctx;
}

export function getPluginContext(): PluginContext | null {
  return _context;
}
