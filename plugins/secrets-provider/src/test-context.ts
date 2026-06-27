/**
 * Channel-independent PluginContext test harness (C-TEST-002) — TEST CODE ONLY.
 *
 * Builds a real `PluginContext` whose `data.collection()` implements the SAME
 * namespaced persistence contract as the radix host
 * (pares-radix/src/lib/platform/plugin-context.ts): records live at
 * `pluresdb:plugin:{pluginId}/{name}/{id}`, `query()` reads every subpath under
 * `{name}/` and filters in memory, get/put/delete/count behave identically.
 *
 * The ONLY test double is the STORAGE backend: an in-memory `Map` stands in for
 * the swappable PluresDBGraph at the storage boundary. This is an allowed real
 * seam double per AGENTS.md (a mock used ONLY inside tests to isolate a
 * dependency, never in a shipped runtime path). The crypto exercised through
 * the provider is the REAL WebCrypto AES-256-GCM/PBKDF2 — never mocked.
 *
 * `rawBytes()` exposes the serialized stored value for a key so security tests
 * can prove no plaintext is present in the persisted node body.
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
    // Round-trip through JSON to mirror the real serialising backend exactly —
    // this is also what makes the "no plaintext in node body" test meaningful:
    // whatever survives JSON.stringify is what would be replicated.
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

  /** The exact serialized bytes that would be persisted/replicated for `key`. */
  rawBytes(key: string): string {
    return JSON.stringify(this.store.get(key) ?? null);
  }

  /** All serialized node bodies (the entire replicated surface) as one string. */
  allRaw(): string {
    return JSON.stringify([...this.store.entries()]);
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

function createNotify(): NotifyAPI {
  return {
    success() {},
    info() {},
    warning() {},
    error() {},
  };
}

function createNavigation(): NavigationAPI {
  return { goto() {}, setBreadcrumbs() {} };
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

function createLLM(): LLMAPI {
  return {
    available: () => false,
    remainingBudget: () => 0,
    async complete() {
      throw new Error('LLM not available in tests');
    },
  };
}

function createInference(): InferenceAPI {
  return {
    async infer() {
      return [];
    },
    async getInferences() {
      return [];
    },
    async confirm() {},
    async getDecisionChain() {
      return [];
    },
  };
}

export interface TestContext {
  ctx: PluginContext;
  graph: InMemoryGraph;
}

/** Construct a real, plugin-scoped PluginContext backed by an in-memory graph. */
export function makeTestContext(pluginId = 'secrets-provider'): TestContext {
  const graph = new InMemoryGraph();
  const collectionCache = new Map<string, DataCollection<unknown>>();

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
    notify: createNotify(),
    navigation: createNavigation(),
    settings: createSettings(),
    llm: createLLM(),
    inference: createInference(),
  };

  return { ctx, graph };
}
