# pares-modulus

Plugin collection for [pares-radix](https://github.com/plures/pares-radix) — domain-specific extensions that add specialized capabilities to the Praxis base application.

**Modulus** (Latin: *measure, standard*) — each plugin is a self-contained module that adds a distinct capability while conforming to the radix plugin contract.

## Plugins

| Plugin | Description | Status | Source Repo |
|---|---|---|---|
| `financial-advisor` | AI-powered personal finance — transaction categorization, budgets, goals, reports | 🚧 Planned | [FinancialAdvisor](https://github.com/plures/FinancialAdvisor) |
| `vault` | Secret management, encryption, key rotation | 🚧 Planned | [plures-vault](https://github.com/plures/plures-vault) |
| `sprint-log` | Sprint tracking, velocity charts, retrospectives | 🚧 Planned | [sprint-log](https://github.com/plures/sprint-log) |
| `netops-toolkit` | Network diagnostics, topology visualization, monitoring | 🚧 Planned | [netops-toolkit-app](https://github.com/plures/netops-toolkit-app) |
| `agent-console` | Agent orchestration, channel management, audit trail | 🚧 Planned | [pares-agens](https://github.com/plures/pares-agens) |

## Architecture

Each plugin implements the `RadixPlugin` interface from `@plures/pares-radix`:

```
pares-modulus/
├── plugins/
│   ├── financial-advisor/
│   │   ├── index.ts          # RadixPlugin manifest
│   │   ├── pages/            # Svelte route components
│   │   ├── rules/            # Praxis inference rules
│   │   ├── expectations/     # Business + UX expectations
│   │   └── stores/           # Domain-specific state
│   ├── vault/
│   ├── sprint-log/
│   ├── netops-toolkit/
│   └── agent-console/
└── shared/                   # Cross-plugin utilities (if any)
```

Plugins contain **only domain logic** — no layout, navigation, settings UI, help pages, import/export, or LLM configuration. That's all handled by radix.

## Migration Plan

Current standalone apps continue development normally. Once pares-radix is feature-complete:

1. Extract domain logic from each app into a modulus plugin
2. Wire up the `RadixPlugin` interface (routes, nav, settings, rules, expectations)
3. Test the plugin running inside radix
4. Archive the standalone repo (or keep it as a standalone Tauri build option)

## Creating a Plugin

```typescript
import type { RadixPlugin } from '@plures/pares-radix';

export default {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '0.1.0',
  icon: '🔧',
  description: 'Does something useful',

  routes: [
    { path: '/', component: () => import('./pages/Home.svelte'), title: 'My Plugin' },
  ],

  navItems: [
    { href: '/my-plugin', label: 'My Plugin', icon: '🔧' },
  ],

  settings: [],
  expectations: [],
  rules: [],

  async onActivate(ctx) {
    // Initialize with platform context (settings, data, llm, inference)
  },
} satisfies RadixPlugin;
```

## License

MIT
