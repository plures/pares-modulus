# Roadmap — pares-modulus

## Vision
A curated plugin registry for pares-radix — like nixpkgs for the Praxis ecosystem. Internal and community plugins go through automated gates and maintainer review before inclusion. Radix discovers, browses, and installs plugins directly from this repo.

## Phase 1 — Registry Infrastructure (Q2 2026)
- [x] Registry schema (`registry/schema.json`)
- [x] Registry index (`registry/index.json`) — auto-built from manifests
- [x] Submission gates: manifest validation, security scan, size audit
- [x] Plugin gate CI workflow (runs on PRs touching `plugins/`)
- [x] Registry build CI workflow (auto-updates index on merge)
- [ ] Contributing guide for plugin authors
- [ ] Plugin submission PR template

## Phase 2 — Financial Advisor Plugin (Q2 2026)
- [x] Plugin manifest + 4 inference rules
- [ ] Page components (dashboard, accounts, transactions, budgets, goals, reports, import, review)
- [ ] PluresDB collections
- [ ] Import parsers (CSV, OFX/QFX)
- [ ] Plugin tests

## Phase 3 — Additional Plugins (Q3 2026)
- [ ] Vault plugin
- [ ] Sprint-log plugin
- [ ] Netops-toolkit plugin
- [ ] Agent-console plugin

## Phase 4 — Community (Q3-Q4 2026)
- [ ] Community submission guidelines
- [ ] Plugin versioning and update mechanism
- [ ] Plugin deprecation policy
- [ ] Federated rule sharing infrastructure
