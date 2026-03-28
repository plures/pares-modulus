# Roadmap — pares-modulus

## Vision
Collection of domain plugins for pares-radix. Each plugin adds specialized functionality while the base handles infrastructure.

## Phase 1 — Financial Advisor Plugin (Q2 2026)
- [x] Plugin manifest (`RadixPlugin` interface)
- [x] 4 core inference rules (recurring-amount, vendor-clustering, refund-detection, tax-variance)
- [ ] Page components (dashboard, accounts, transactions, budgets, goals, reports, import, review)
- [ ] PluresDB collections for accounts, transactions, budgets, goals, inferences
- [ ] Import parsers (CSV, OFX/QFX)
- [ ] Categorization review UI with confidence display
- [ ] Dashboard widgets (net worth, budget status, recent transactions)

## Phase 2 — Additional Plugins (Q3 2026)
- [ ] Vault plugin — secret management, encryption, key rotation
- [ ] Sprint-log plugin — sprint tracking, velocity, retrospectives
- [ ] Netops-toolkit plugin — network diagnostics, topology, monitoring
- [ ] Agent-console plugin — agent orchestration, channel management

## Phase 3 — Cross-Plugin Intelligence (Q3-Q4 2026)
- [ ] Shared inference patterns
- [ ] Cross-plugin context awareness
- [ ] Federated rule sharing
