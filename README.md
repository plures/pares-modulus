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
│   ├── schema.json             # Plugin manifest validation schema
│   └── contracts/              # Versioned host-effect contracts consumed by Radix/extensions
│   └── native-extensions/v1/   # Immutable archive catalog consumed by the native host
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

## Native extension releases

Native Modulus extensions are not installed from a source folder. Radix resolves
one immutable record from `registry/native-extensions/v1/index.json`, verifies
its SHA-256 archive digest, stages it below the host-owned extension root, and
then asks the PX activation procedure to admit the transition. A catalog record
contains the exact extension version, its published `radix-host-effects` CID,
an HTTPS `tar.gz` asset, and the immutable `plures/praxis-platform` source
revision that produced it.

The catalog starts empty deliberately: a record is added only after the source
extension has merged and the promotion workflow packages the exact commit.
This avoids publishing a link that the desktop host can discover but cannot
securely acquire.

### Promoting a native release

Use **Actions → Native Extension Catalog → Run workflow** after the extension
source is merged. Supply its kebab-case id, version, exact 40-character
`praxis-platform` commit SHA, and a CID already published under
`registry/contracts/`. The workflow:

1. uses the organization GitHub App installation token to read the private
   platform source — no personal access token is maintained;
2. creates a deterministic root-level `tar.gz` containing the manifest,
   compiled bundle, and procedures;
3. publishes that exact archive as a one-time GitHub Release asset;
4. opens a normal reviewed PR adding the SHA-256-pinned release record.

The workflow fails closed if the source SHA is not immutable, the manifest does
not exactly match the requested release, the CID is not in the published host
effects index, or a release version already exists. Configure the organization
GitHub App once with read access to `plures/praxis-platform` and write access
to `plures/pares-modulus`, then expose its id as `PLURES_RELEASE_APP_ID` and
private key as `PLURES_RELEASE_APP_PRIVATE_KEY` to this repository.

## Community Guidelines

- **One plugin per directory** in `plugins/`
- **Plugin IDs are unique** and kebab-case
- **Breaking changes** require a version bump in `manifest.json`
- **Plugins must be self-contained** — no imports between plugins
- **Tests are encouraged** — plugins with tests get a "tested" badge in the registry
- **Inactive plugins** (no updates for 12 months) get a deprecation warning

## License

MIT — individual plugins may have their own licenses specified in their `manifest.json`.
