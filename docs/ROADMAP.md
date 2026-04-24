# pares-modulus Roadmap

## Role in OASIS
Pares Modulus is the plugin registry and distribution channel for OASIS. It curates, validates, and ships Radix plugins so OASIS features can be delivered as composable, updateable modules.

## Current State
- Registry schema/index and plugin gates are implemented.
- Financial advisor plugin UI pages landed (dashboard, budgets, reports, review).
- No open issues/PRs right now.

## Phase 1 — Registry Maturity
- Publish contributor guide + submission PR template.
- Harden gate scripts (schema validation, security scan, size audit) and document failure modes.
- Add compatibility checks for Radix and design‑dojo versions.
- Establish versioning policy and deprecation workflow for plugins.

## Phase 2 — Core OASIS Plugins
- Finish Financial Advisor plugin wiring (PluresDB collections + import parsers + tests).
- Add Vault plugin scaffold with manifest + minimal UI shell.
- Add Agent Console plugin scaffold for agent orchestration visibility.

## Phase 3 — Ecosystem Expansion
- Bring in Sprint‑log, Netops toolkit, and other internal apps as plugins.
- Standardize plugin metadata (icons, keywords, permissions, data scopes).
- Add plugin telemetry hooks (opt‑in) for reliability and UX signals.

## Phase 4 — Community & Distribution
- Public submission guidelines and review workflow.
- Plugin update channels (stable/beta) with signed manifests.
- Federated rule sharing packaged as opt‑in plugin bundles.
