# Radix Plugin Author Guide

> How to build, test, and submit a plugin for the pares-radix platform via pares-modulus.

## Quick Start

```bash
# 1. Fork pares-modulus
gh repo fork plures/pares-modulus --clone
cd pares-modulus

# 2. Create plugin directory
mkdir -p plugins/my-plugin/src

# 3. Create manifest
cat > plugins/my-plugin/manifest.json << 'EOF'
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "A brief description (max 200 chars)",
  "author": "your-name",
  "license": "MIT",
  "icon": "🔧",
  "entry": "src/index.ts",
  "radix": ">=0.1.0",
  "dependencies": [],
  "keywords": ["example"]
}
EOF

# 4. Create entry file
cat > plugins/my-plugin/src/index.ts << 'EOF'
import type { RadixPlugin } from '@plures/pares-radix';

const myPlugin: RadixPlugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '0.1.0',
  icon: '🔧',
  description: 'A brief description',
  routes: [],
  navItems: [],
  settings: [],
};

export default myPlugin;
EOF

# 5. Validate
npx tsx gates/validate-manifest.ts plugins/my-plugin
```

## manifest.json Reference

Based on `registry/schema.json`:

| Field | Required | Type | Description |
|---|---|---|---|
| `id` | ✅ | `string` | Unique kebab-case identifier (`^[a-z][a-z0-9-]*$`) |
| `name` | ✅ | `string` | Human-readable name |
| `version` | ✅ | `string` | SemVer (`^\d+\.\d+\.\d+`) |
| `description` | ✅ | `string` | Max 200 characters |
| `author` | ✅ | `string` | Author name or org |
| `license` | ✅ | `string` | SPDX license identifier |
| `entry` | ✅ | `string` | Relative path to plugin entry file |
| `radix` | ✅ | `string` | Required pares-radix version range |
| `icon` | | `string` | Emoji or icon identifier |
| `keywords` | | `string[]` | Up to 10 keywords |
| `homepage` | | `string` | URL |
| `repository` | | `string` | Repository URL |
| `dependencies` | | `string[]` | Other modulus plugin IDs this depends on |
| `peerDependencies` | | `object` | Package version ranges (e.g., `@plures/design-dojo`) |
| `size` | | `object` | `{ source, estimated_bundle }` size strings |

No additional fields allowed.

## RadixPlugin Interface

Your entry file's default export must satisfy `RadixPlugin` (from `pares-radix/src/lib/types/plugin.ts`).

### Required Fields

```typescript
const plugin: RadixPlugin = {
  id: 'my-plugin',          // Must match manifest.json id
  name: 'My Plugin',
  version: '0.1.0',
  icon: '🔧',
  description: 'What it does',
  routes: [],                // At minimum, empty array
  navItems: [],
  settings: [],
};
```

### Registering Routes

```typescript
routes: [
  {
    path: '/',                    // Becomes /my-plugin/
    component: () => import('./pages/Home.svelte'),
    title: 'My Plugin Home',
  },
  {
    path: '/detail',              // Becomes /my-plugin/detail
    component: () => import('./pages/Detail.svelte'),
    title: 'Detail View',
    requires: [{                  // Shows empty state if unmet
      type: 'items',
      minCount: 1,
      emptyMessage: 'No items yet. Create one to get started.',
      fulfillHref: '/my-plugin/',
      fulfillLabel: 'Create Item',
    }],
  },
],
```

Routes are namespaced by plugin ID automatically via the plugin-loader's `getAllRoutes()`.

### Navigation Items

```typescript
navItems: [
  {
    href: '/my-plugin',
    label: 'My Plugin',
    icon: '🔧',
    children: [
      { href: '/my-plugin/detail', label: 'Detail', icon: '📋' },
    ],
    badge: () => unreadCount,   // Optional dynamic badge
  },
],
```

### Settings

```typescript
settings: [
  {
    key: 'my-plugin.theme',      // Namespaced key
    type: 'select',              // toggle | select | text | number | password | color
    label: 'Theme',
    description: 'Color theme for the plugin',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
    ],
    group: 'My Plugin',          // Groups settings visually
  },
],
```

Radix renders settings automatically in the unified settings page. Access values via `PluginContext.settings`.

### Dashboard Widgets

```typescript
dashboardWidgets: [
  {
    id: 'mp-summary',
    title: 'My Plugin Summary',
    component: () => import('./widgets/Summary.svelte'),
    colspan: 2,                  // 1-4 grid columns
    priority: 20,                // Lower = renders first
  },
],
```

### Help Sections

```typescript
helpSections: [
  {
    title: 'Getting Started',
    icon: '📖',
    content: '## Setup\n\n1. Do this\n2. Then that',  // Markdown string
    priority: 10,
  },
],
```

### Onboarding Steps

```typescript
onboardingSteps: [
  {
    title: 'Create Your First Item',
    description: 'Set up the basics.',
    icon: '✨',
    href: '/my-plugin/',
    actionLabel: 'Get Started',
    isComplete: () => itemCount > 0,
    after: [],                   // Plugin IDs whose steps must complete first
  },
],
```

## Using Platform APIs

All APIs are available via `PluginContext`, received in `onActivate`:

```typescript
async onActivate(ctx: PluginContext) {
  // Store ctx for use in components
  setContext(ctx);
}
```

### SettingsAPI

```typescript
const theme = ctx.settings.get<string>('my-plugin.theme');
ctx.settings.set('my-plugin.theme', 'dark');
const unsub = ctx.settings.subscribe('my-plugin.theme', (val) => { ... });
```

### DataAPI (PluresDB)

```typescript
const items = ctx.data.collection('items');   // Namespaced to plugin
await items.put('item-1', { name: 'Foo', value: 42 });
const item = await items.get('item-1');
const all = await items.query({ value: 42 });
const count = await items.count();
await items.delete('item-1');
```

### LLMAPI

```typescript
if (ctx.llm.available()) {
  const budget = ctx.llm.remainingBudget();
  const response = await ctx.llm.complete(
    'Summarize these items',
    { items: myItems }
  );
}
```

**Best practice:** Use praxis inference rules for deterministic categorization. Reserve LLM for novel/ambiguous cases.

### InferenceAPI

```typescript
const inferences = await ctx.inference.infer('my-type', record);
const existing = await ctx.inference.getInferences(sourceId);
await ctx.inference.confirm(inferenceId, true);   // User confirms
const chain = await ctx.inference.getDecisionChain(inferenceId);
```

### NavigationAPI

```typescript
ctx.navigation.goto('/my-plugin/detail');
ctx.navigation.setBreadcrumbs([
  { label: 'My Plugin', href: '/my-plugin' },
  { label: 'Detail' },
]);
```

### NotifyAPI

```typescript
ctx.notify.success('Item created!');
ctx.notify.error('Failed to save.');
ctx.notify.info('Processing...');
ctx.notify.warning('Quota running low.');
```

## Adding Praxis Inference Rules

Rules implement `InferenceRule` from `@plures/pares-radix`:

```typescript
import type { InferenceRule, InferenceInput } from '@plures/pares-radix';

export const myRule: InferenceRule = {
  id: 'mp-pattern-match',
  name: 'Pattern Match',
  description: 'Matches items to categories based on name patterns',
  appliesTo: ['my-item-type'],
  baseConfidence: 0.80,

  evaluate(input: InferenceInput) {
    const { record, confirmedInferences } = input;
    // Your logic here
    // Return null if rule doesn't apply
    // Return InferenceResult if it does:
    return {
      field: 'category',
      value: 'detected-category',
      confidence: 0.85,
      reasoning: 'Name pattern "xyz" matched 5 confirmed items in this category.',
    };
  },
};
```

Register in your plugin:

```typescript
rules: [myRule],
```

The inference engine (`pares-radix/src/lib/platform/inference-engine.ts`) handles:
- Running all rules that match `appliesTo`
- Compound confidence when multiple rules agree: `1 - ∏(1 - cᵢ)`
- Auto-confirm at ≥0.90 confidence
- User gate at <0.70 confidence
- Decision ledger (full audit trail)

## Adding UX Expectations

```typescript
expectations: [
  {
    id: 'mp-data-integrity',
    domain: 'business',        // business | security | performance | ux | inference
    description: 'Items must have unique names',
    severity: 'error',         // error | warning | info
    validate: async (state) => {
      // Return true if expectation is met
      return true;
    },
  },
],
```

Radix has built-in UX expectations (in `praxis/ux-contracts.ts`):
- **ux-no-dead-ends**: Every route must be reachable from nav
- **ux-data-prereqs-have-empty-states**: Routes with `requires` must have `emptyMessage`, `fulfillHref`, `fulfillLabel`
- **ux-nav-items-resolve**: All nav hrefs must point to registered routes

Your plugin's routes and nav items are automatically validated against these.

## Testing Your Plugin

### Unit Tests (Inference Rules)

```typescript
import { describe, it, expect } from 'vitest';
import { myRule } from './rules/my-rule';

describe('myRule', () => {
  it('returns null when no pattern matches', () => {
    const result = myRule.evaluate({
      record: { name: 'unknown' },
      history: [],
      priorInferences: [],
      confirmedInferences: [],
    });
    expect(result).toBeNull();
  });

  it('returns inference with correct confidence', () => {
    const result = myRule.evaluate({
      record: { name: 'known-pattern' },
      history: [],
      priorInferences: [],
      confirmedInferences: [/* mocks */],
    });
    expect(result?.confidence).toBeGreaterThan(0.80);
  });
});
```

### Integration Tests (Plugin Registration)

```typescript
import { registerPlugin, activateAll, getAllRoutes, getAllNavItems } from '@plures/pares-radix';
import myPlugin from './index';

// Register and activate
registerPlugin(myPlugin);
await activateAll(mockContext);

// Verify
expect(getAllRoutes()).toContainEqual(expect.objectContaining({ path: '/my-plugin' }));
expect(getAllNavItems()).toContainEqual(expect.objectContaining({ label: 'My Plugin' }));
```

### UX Contract Validation

```typescript
import { validateUxExpectations } from '@plures/pares-radix';

const violations = await validateUxExpectations(myPlugin.expectations);
expect(violations).toHaveLength(0);
```

## Submitting to Modulus

### Pre-submission Checklist

- [ ] `manifest.json` passes validation: `npx tsx gates/validate-manifest.ts plugins/my-plugin`
- [ ] Entry file exports a valid `RadixPlugin` as default
- [ ] All routes have titles
- [ ] Routes with data requirements have complete empty states
- [ ] Nav items point to registered routes
- [ ] Settings keys are namespaced (`plugin-id.setting-name`)
- [ ] Inference rules have unique IDs
- [ ] Tests pass

### Submission Process

1. Fork `plures/pares-modulus`
2. Add your plugin under `plugins/your-plugin/`
3. Run gates locally:
   ```bash
   npx tsx gates/validate-manifest.ts plugins/your-plugin
   npx tsx gates/size-audit.ts plugins/your-plugin
   npx tsx gates/security-scan.ts plugins/your-plugin
   ```
4. Open a PR to `main`
5. CI runs automatically:
   - `plugin-gate.yml` — manifest validation, size audit, security scan
   - `ci.yml` — lint, type-check
   - `build-registry.yml` — rebuilds `registry/index.json`
6. Review + approval required
7. On merge, plugin appears in the registry

### Gate Details

| Gate | File | What it checks |
|---|---|---|
| Manifest validation | `gates/validate-manifest.ts` | Required fields, id format, version format, description length, entry file exists, no unknown fields |
| Size audit | `gates/size-audit.ts` | Bundle size limits |
| Security scan | `gates/security-scan.ts` | Dependency vulnerabilities, unsafe patterns |
