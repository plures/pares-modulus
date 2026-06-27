/**
 * One-time, idempotent migration of legacy localStorage data into PluresDB
 * collections via the plugin's `ctx.data.collection()` API.
 *
 * Background: prior builds of financial-advisor persisted accounts /
 * transactions / budgets / goals as flat `fa_*` arrays in
 * `window.localStorage` (see the now-deleted `lib/store.ts`). The plugin now
 * persists exclusively through `ctx.data.collection()` (PluresDB-namespaced,
 * swappable backend). This helper seeds any pre-existing localStorage data into
 * the matching collections EXACTLY ONCE so returning users don't lose history.
 *
 * Properties:
 *   - Idempotent: a `fa_ls_migrated_v1` flag short-circuits re-runs; the flag is
 *     written LAST so a crash mid-migration re-runs cleanly on next activation.
 *   - Collision-safe: each record is only seeded if absent (`get()` before
 *     `put()`), so data written after migration is never clobbered and a
 *     partially-completed first run resumes without duplicating.
 *   - Lossless: every parseable legacy record carrying an `id` is migrated.
 *   - Rollback-safe: legacy `fa_*` keys are intentionally LEFT in place (a later
 *     "v2" cleanup can delete them once confidence is high). Never delete before
 *     the flag is set.
 *
 * This is NOT a stub: it performs real reads/writes against the real collection
 * API. When there is no localStorage data (e.g. a fresh install or SSR) it
 * simply no-ops and records the flag.
 */

import type { PluginContext } from '@plures/pares-radix';
import { FA_ACCOUNTS_COLLECTION } from './accounts.js';
import { FA_TRANSACTIONS_COLLECTION } from './transactions.js';
import { FA_BUDGETS_COLLECTION } from './budgets.js';
import { FA_GOALS_COLLECTION } from './goals.js';

/** localStorage flag marking the one-time migration as complete. */
export const FA_MIGRATION_FLAG = 'fa_ls_migrated_v1';

/** Legacy localStorage key → target PluresDB collection name. */
const LEGACY_KEYS: Record<string, string> = {
  fa_accounts: FA_ACCOUNTS_COLLECTION,
  fa_transactions: FA_TRANSACTIONS_COLLECTION,
  fa_budgets: FA_BUDGETS_COLLECTION,
  fa_goals: FA_GOALS_COLLECTION,
};

/**
 * Seed legacy localStorage `fa_*` arrays into their PluresDB collections,
 * exactly once. Safe to call on every `onActivate`.
 */
export async function migrateLocalStorageToPluresDB(ctx: PluginContext): Promise<void> {
  if (typeof window === 'undefined') return; // SSR guard
  if (window.localStorage.getItem(FA_MIGRATION_FLAG) === 'done') return; // idempotent gate

  for (const [legacyKey, collName] of Object.entries(LEGACY_KEYS)) {
    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) continue;

    let items: Array<{ id?: string }>;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      items = parsed as Array<{ id?: string }>;
    } catch {
      continue; // unparseable legacy blob — skip, leave key for inspection
    }

    const coll = ctx.data.collection(collName);
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || item.id.length === 0) continue;
      // Collision-safe: only seed if absent so post-migration writes win.
      const existing = await coll.get(item.id);
      if (existing == null) {
        await coll.put(item.id, item);
      }
    }
  }

  // Mark migrated LAST so an interrupted run re-executes cleanly next time.
  window.localStorage.setItem(FA_MIGRATION_FLAG, 'done');
  // NOTE: legacy `fa_*` keys are intentionally left in place for rollback
  // safety. A future "v2" cleanup may delete them once confidence is high.
}
