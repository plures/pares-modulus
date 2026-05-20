# Pares-Radix Plugin Template

A ready-to-go template for building pares-radix plugins.

## What You Get

```
template/
├── manifest.json          # Plugin metadata (schema-validated)
├── src/
│   ├── index.ts           # Plugin entry + lifecycle hooks
│   └── handlers/
│       └── index.ts       # ActionHandler implementations (your IO boundary)
├── px/
│   ├── main.px            # Your declarative logic (auto-compiled by radix)
│   └── constraints.px    # Domain constraints (enforced before actions)
└── tests/
    └── plugin.px          # Executable test scenarios
```

## How It Works

1. **Write .px files** in `px/` — these are your application logic
2. **Implement handlers** in `src/handlers/` — these are the IO boundary
3. **That's it.** Pares-radix handles the rest:
   - Compiles .px → PluresDB procedure records
   - Registers your handlers as ActionHandler implementations
   - Fires procedures reactively on events
   - Records state mutations in Chronos automatically
   - Persists everything in PluresDB

## Create a New Plugin

```bash
# From the pares-modulus repo root:
cp -r template plugins/my-plugin

# Edit the manifest:
# - Replace {{plugin-id}} with your plugin id (kebab-case)
# - Replace {{Plugin Name}} with your display name
# - Replace {{your-name}} with your name/org
# - Fill in description and keywords

# Edit src/handlers/index.ts:
# - Add your actual ActionHandler implementations

# Write your logic in px/main.px:
# - Define procedures, triggers, constraints

# Test:
# - Write test procedures in tests/plugin.px
# - Run: px run tests/plugin.px
```

## The Pattern

Every pares-radix plugin follows the same architecture:

```
.px files (WHAT to do — declarative logic)
    ↓ compiled by pares-radix
PluresDB (persistence + reactive triggers)
    ↓ event dispatch
ActionHandlers (HOW to do it — your IO boundary)
```

You write **what** (declarative .px procedures).  
You implement **how** (action handlers for your specific IO).  
PluresDB provides **when** (reactive triggers), **persistence** (CRDT store),  
and **observability** (Chronos timeline) — all for free.

## What You Get for Free (from pares-radix)

- 🗄️ **PluresDB** — CRDT persistence, sync, vector search
- ⚡ **Reactive dispatch** — procedures fire on events, state changes, timers
- 📊 **Chronos** — every state mutation recorded with causal chains
- 🔒 **Praxis constraints** — blocking enforcement before dangerous actions
- 🧪 **Test harness** — .px test procedures with assertions
- 🔄 **Hot reload** — .px files recompile on change (dev mode)
- 🤖 **Agent integration** — procedures can be called as tools by the agent
- 🌐 **P2P sync** — PluresDB data syncs to peers via Hyperswarm

## Publishing

1. Validate your manifest: `scripts/validate-manifest.sh plugins/my-plugin`
2. Open a PR to pares-modulus
3. Automated gates run (schema, type-check, size audit, security scan)
4. Maintainer review
5. Merged → available in `radix plugin browse`
