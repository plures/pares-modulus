# pares-modulus

The plugin registry for [pares-radix](https://github.com/plures/pares-radix) — a curated, gated collection of plugins that radix discovers, browses, and installs from directly.

**Modulus** works like [nixpkgs](https://github.com/NixOS/nixpkgs): a single repo containing plugin definitions, metadata, and source. Anyone can submit a plugin via PR. Submissions go through automated gates (CI, type-check, security scan, size audit) and maintainer review before merging.

## How It Works

```
pares-radix (app)
    │
    ├── radix plugin browse     →  fetches registry/index.json from modulus
    ├── radix plugin install X  →  pulls plugin source from modulus/plugins/X/
    └── radix plugin update     →  checks for newer versions in registry
```

### For Users (in radix)

```bash
# Browse available plugins
radix plugin browse

# Install a plugin
radix plugin install financial-advisor

# Update all plugins
radix plugin update
```

### For Plugin Authors (submitting to modulus)

```bash
# 1. Fork pares-modulus
# 2. Add your plugin
mkdir plugins/my-plugin
# 3. Create the required files (see structure below)
# 4. Open a PR — automated gates run
```

## Repository Structure

```
pares-modulus/
├── registry/
│   ├── index.json              # Machine-readable plugin catalog
│   └── schema.json             # Plugin manifest validation schema
├── plugins/
│   ├── financial-advisor/
│   │   ├── manifest.json       # Plugin metadata (name, version, deps, etc.)
│   │   ├── src/                # Plugin source code
│   │   │   ├── index.ts        # RadixPlugin export
│   │   │   ├── pages/          # Svelte components
│   │   │   ├── rules/          # Praxis inference rules
│   │   │   └── stores/         # Domain state
│   │   ├── tests/              # Plugin tests
│   │   └── README.md           # Plugin documentation
│   ├── vault/
│   ├── sprint-log/
│   ├── netops-toolkit/
│   └── agent-console/
├── gates/                      # Submission gate scripts
│   ├── validate-manifest.ts    # Schema validation
│   ├── security-scan.ts        # Dependency audit + no secrets
│   ├── size-audit.ts           # Bundle size limits
│   └── type-check.ts           # TypeScript strict compliance
├── scripts/
│   ├── build-registry.ts       # Rebuilds registry/index.json from plugins/
│   └── validate-all.ts         # Runs all gates on all plugins
└── .github/
    └── workflows/
        ├── plugin-gate.yml     # PR gate: runs all checks on changed plugins
        ├── build-registry.yml  # Post-merge: rebuilds index.json
        └── ...                 # Standard plures automation
```

## Plugin Manifest (`manifest.json`)

Every plugin must include a `manifest.json`:

```json
{
  "id": "financial-advisor",
  "name": "Financial Advisor",
  "version": "0.1.0",
  "description": "AI-powered personal finance management with praxis inference",
  "author": "plures",
  "license": "MIT",
  "icon": "💰",
  "keywords": ["finance", "budgets", "transactions", "categorization"],
  "homepage": "https://github.com/plures/pares-modulus/tree/main/plugins/financial-advisor",
  "repository": "https://github.com/plures/pares-modulus",
  "radix": ">=0.1.0",
  "dependencies": [],
  "peerDependencies": {
    "@plures/design-dojo": ">=0.1.0"
  },
  "entry": "src/index.ts",
  "size": {
    "source": "25KB",
    "estimated_bundle": "40KB"
  }
}
```

## Submission Gates

All PRs that touch `plugins/` must pass:

| Gate | Description | Failure = |
|---|---|---|
| **Manifest Validation** | `manifest.json` matches schema, all required fields present | Block |
| **Type Check** | `tsc --noEmit --strict` on plugin source | Block |
| **Security Scan** | No hardcoded secrets, dependency audit clean | Block |
| **Size Audit** | Source under 500KB, no binary blobs | Block |
| **Tests** | Plugin tests pass (if `tests/` exists) | Warn |
| **Radix Compatibility** | Plugin exports valid `RadixPlugin` interface | Block |
| **Maintainer Review** | Human approval required | Block |

## Registry Index

`registry/index.json` is auto-generated on merge and serves as the catalog radix queries:

```json
{
  "version": 1,
  "generated": "2026-03-27T18:00:00Z",
  "plugins": [
    {
      "id": "financial-advisor",
      "name": "Financial Advisor",
      "version": "0.1.0",
      "description": "AI-powered personal finance management with praxis inference",
      "author": "plures",
      "icon": "💰",
      "keywords": ["finance", "budgets"],
      "radix": ">=0.1.0",
      "size": "25KB",
      "path": "plugins/financial-advisor"
    }
  ]
}
```

## Community Guidelines

- **One plugin per directory** in `plugins/`
- **Plugin IDs are unique** and kebab-case
- **Breaking changes** require a version bump in `manifest.json`
- **Plugins must be self-contained** — no imports between plugins
- **Tests are encouraged** — plugins with tests get a "tested" badge in the registry
- **Inactive plugins** (no updates for 12 months) get a deprecation warning

## License

MIT — individual plugins may have their own licenses specified in their `manifest.json`.
