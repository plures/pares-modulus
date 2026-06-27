/**
 * Channel-independent PluginContext test harness (C-TEST-002) — TEST CODE ONLY.
 *
 * Builds a real `PluginContext` whose `data.collection()` implements the SAME
 * namespaced persistence contract as the radix host
 * (`pares-radix/src/lib/platform/plugin-context.ts`): records live at
 * `pluresdb:plugin:{pluginId}/{name}/{id}`, `query()` reads every subpath under
 * `{name}/` and filters in memory, `get()`/`put()`/`delete()`/`count()` behave
 * identically.
 *
 * The ONLY test double is the storage backend: an in-memory `Map` stands in for
 * the swappable PluresDBGraph at the storage boundary. This is an allowed real
 * seam double per AGENTS.md (a mock used ONLY inside tests to isolate a
 * dependency, never in a shipped runtime path). The collection logic exercised
 * here is the real contract the plugin depends on — not a stub of it.
 *
 * `window.localStorage` is also shimmed in-memory so `migrate.ts` (which reads
 * legacy `fa_*` keys and writes the migration flag) runs under Node/vitest
 * exactly as it would in a browser.
 */

import type {
  PluginContext,
  DataCollection,
  NotifyAPI,
  NavigationAPI,
  SettingsAPI,
  LLMAPI,
  InferenceAPI,
} from '@plures/pares-radix';

/** Namespacing prefix — must match the host's PLUGIN_DATA_PREFIX. */
export const PLUGIN_DATA_PREFIX = 'pluresdb:plugin:';

/** In-memory key/value store standing in for the PluresDBGraph (storage seam). */
export class InMemoryGraph {
  readonly store = new Map<string, unknown>();

  put(key: string, value: unknown): void {
    // Round-trip through JSON to mirror the real serialising backend.
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  get(key: string): unknown {
    return this.store.has(key) ? this.store.get(key) : undefined;
  }

  keys(prefix = ''): string[] {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

function shallowMatches(doc: unknown, filter: Record<string, unknown>): boolean {
  if (doc === null || typeof doc !== 'object') return false;
  const rec = doc as Record<string, unknown>;
  for (const [k, want] of Object.entries(filter)) {
    if (rec[k] !== want) return false;
  }
  return true;
}

/** Build a real CollectionAPI over the in-memory graph, namespaced by plugin. */
function createCollection<T>(
  graph: InMemoryGraph,
  pluginId: string,
  name: string,
): DataCollection<T> {
  const keyFor = (id: string) => `${PLUGIN_DATA_PREFIX}${pluginId}/${name}/${id}`;
  const prefix = `${PLUGIN_DATA_PREFIX}${pluginId}/${name}/`;

  return {
    async get(id: string): Promise<T | null> {
      const v = graph.get(keyFor(id));
      return (v ?? null) as T | null;
    },
    async put(id: string, data: T): Promise<void> {
      graph.put(keyFor(id), data);
    },
    async delete(id: string): Promise<void> {
      graph.delete(keyFor(id));
    },
    async query(filter?: Record<string, unknown>): Promise<T[]> {
      const rows = graph.keys(prefix).map((k) => graph.get(k)) as T[];
      if (!filter || Object.keys(filter).length === 0) return rows;
      return rows.filter((doc) => shallowMatches(doc, filter));
    },
    async count(): Promise<number> {
      return graph.keys(prefix).length;
    },
  };
}

/** No-op-but-recording NotifyAPI (real sink; records calls for assertions). */
export interface RecordingNotify extends NotifyAPI {
  readonly calls: Array<{ level: string; message: string }>;
}

function createNotify(): RecordingNotify {
  const calls: Array<{ level: string; message: string }> = [];
  return {
    calls,
    success(m) {
      calls.push({ level: 'success', message: m });
    },
    info(m) {
      calls.push({ level: 'info', message: m });
    },
    warning(m) {
      calls.push({ level: 'warning', message: m });
    },
    error(m) {
      calls.push({ level: 'error', message: m });
    },
  };
}

function createNavigation(): NavigationAPI {
  return {
    goto() {
      /* recorded as no-op in tests */
    },
    setBreadcrumbs() {
      /* recorded as no-op in tests */
    },
  };
}

function createSettings(): SettingsAPI {
  const map = new Map<string, unknown>();
  return {
    get<T = unknown>(key: string): T {
      return map.get(key) as T;
    },
    set(key, value) {
      map.set(key, value);
    },
    subscribe() {
      return () => {};
    },
  };
}

/** LLM is honestly unavailable in tests (no provider) — matches host default. */
function createLLM(): LLMAPI {
  return {
    available: () => false,
    remainingBudget: () => 0,
    async complete() {
      throw new Error('LLM not available in tests');
    },
  };
}

/** Minimal real InferenceAPI over a collection (not used by the data tests). */
function createInference(): InferenceAPI {
  return {
    async infer() {
      return [];
    },
    async getInferences() {
      return [];
    },
    async confirm() {
      /* no-op */
    },
    async getDecisionChain() {
      return [];
    },
  };
}

export interface TestContext {
  ctx: PluginContext;
  graph: InMemoryGraph;
  notify: RecordingNotify;
}

/**
 * Construct a real, plugin-scoped PluginContext backed by an in-memory graph.
 * @param pluginId default 'financial-advisor'
 */
export function makeTestContext(pluginId = 'financial-advisor'): TestContext {
  const graph = new InMemoryGraph();
  const collectionCache = new Map<string, DataCollection<unknown>>();
  const notify = createNotify();

  const ctx: PluginContext = {
    data: {
      collection<T = Record<string, unknown>>(name: string): DataCollection<T> {
        let coll = collectionCache.get(name);
        if (!coll) {
          coll = createCollection<unknown>(graph, pluginId, name);
          collectionCache.set(name, coll);
        }
        return coll as DataCollection<T>;
      },
    },
    notify,
    navigation: createNavigation(),
    settings: createSettings(),
    llm: createLLM(),
    inference: createInference(),
  };

  return { ctx, graph, notify };
}

/** Install an in-memory window.localStorage shim for migrate.ts tests. */
export function installLocalStorageShim(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
  (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: storage };
  return storage;
}

/** Remove the localStorage / window shim. */
export function clearLocalStorageShim(): void {
  delete (globalThis as { window?: unknown }).window;
}
