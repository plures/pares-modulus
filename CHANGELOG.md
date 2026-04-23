## [0.2.0] — 2026-04-23

- feat(release): add target_version input for milestone-driven releases (3fdae6d)
- feat(lifecycle): milestone-close triggers roadmap-aware release (1e1aa31)
- feat(lifecycle v12): auto-release when milestone completes (6b56179)
- feat(lifecycle v11): smart CI failure handling — infra vs code (7565969)
- fix(lifecycle): label-based retry counter + CI fix priority (679ec7c)
- ci: lifecycle — add unmilestoned issue fallback + force-merge on CI exhaustion (efe138d)
- ci: lifecycle v10 — auto-retry transient failures, force-merge on exhaustion (e5568c9)
- ci: inline lifecycle workflow — fix schedule failures (aee51b6)
- chore: remove redundant workflow — handled by centralized ci-reusable.yml or obsolete (5179530)
- Merge pull request #22 from plures/copilot/refactor-replace-raw-html-primitives (d91296b)
- fix: restore aria-modal attribute on Dialog components for accessibility (05dc209)
- refactor: replace raw HTML primitives with @plures/design-dojo components (8f1b7fa)
- Initial plan (6b24dc3)
- chore: centralize CI to org-wide reusable workflow (ef1d244)
- ci: add Design-Dojo UI compliance gate (77e43bb)
- ci: standardize Node version to lts/* — remove hardcoded versions (f7edf04)
- feat: dashboard widgets — net worth, budget status, recent transactions (#19) (f7cfb1b)
- feat: Reports page — spending trends, budget variance, cash flow (#18) (d6867ed)
- feat: Budgets page — category budgets with spend tracking and MoM comparison (#17) (49f8392)
- Merge pull request #16 from plures/copilot/feat-review-page-batch-confirm-reject-categorizati (68b121f)
- Merge branch 'main' into copilot/feat-review-page-batch-confirm-reject-categorizati (1a50edf)
- ci: tech-doc-writer triggers on minor prerelease only [actions-optimization] (231c2c2)
- Merge branch 'main' into copilot/feat-review-page-batch-confirm-reject-categorizati (3917901)
- ci: add concurrency group to copilot-pr-lifecycle [actions-optimization] (02f6596)
- Apply Copilot review suggestions (125718d)
- feat: Review page — batch confirm/reject categorizations by confidence (36cd139)
- Initial plan (d468678)
- feat: Transactions page — browse, filter, manual categorize (#15) (7554051)
- ci: centralize lifecycle — event-driven with schedule guard (4984ced)
- fix(lifecycle): v9.2 — process all PRs per tick (return→continue), widen bot filter (3bb7d61)
- fix(lifecycle): change return→continue so all PRs process in one tick (0407b35)
- fix(lifecycle): v9.1 — fix QA dispatch (client_payload as JSON object) (9185fa4)
- fix(lifecycle): rewrite v9 — apply suggestions, merge, no nudges (a9709b3)
- Merge pull request #14 from plures/copilot/add-import-page-file-upload (603f9b4)
- fix: address review comments — OFX deterministic IDs, XML parse error detection, divide-by-zero guard, safe retry on partial commit failure (34cb733)
- Update plugins/financial-advisor/src/lib/parsers/csv.ts (4dd68f5)
- Update plugins/financial-advisor/src/pages/Import.svelte (af09a2c)
- Update plugins/financial-advisor/src/pages/Import.svelte (b74cc4e)
- Update plugins/financial-advisor/src/pages/Import.svelte (80587c1)
- feat: Import page — CSV and OFX/QFX file upload with parsing (d5920f9)
- Initial plan (5263e1f)
- feat: Accounts page — create, edit, delete accounts with PluresDB (#13) (1bfbd62)
- fix: resolve post-merge CI failures (lint, typecheck) at c619683 (#12) (031ab1f)
- chore: standardize license to MIT (a730cd4)
- chore: rebuild registry index [skip ci] (f9bc35c)
- fix: resolve post-merge CI failures (lint, typecheck, build) (#11) (e8c64a4)
- docs: add plugin author guide for radix plugin development (f869bf7)
- feat: restructure as plugin registry (nixpkgs-style) (c619683)
- chore: add CI, Copilot automation, build tooling (88a0202)
- feat: initial pares-modulus with financial-advisor plugin and inference rules (226ece7)

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Financial Advisor plugin manifest with full `RadixPlugin` interface
- 4 core praxis inference rules:
  - `recurring-amount`: Matches recurring vendor+amount patterns with compound confidence
  - `vendor-clustering`: Groups variant vendor names (AMZN/Amazon.com/AMAZON MARKETPLACE) with known alias map
  - `refund-detection`: Identifies small credits matching price change deltas
  - `tax-variance`: Detects correlated small % increases across multiple vendors (tax rate changes)
- Plugin skeletons for vault, sprint-log, netops-toolkit, agent-console
