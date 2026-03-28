## [0.1.1] — 2026-03-28

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
