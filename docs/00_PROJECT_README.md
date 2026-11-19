# Turnpike — Documentation Package (Entrypoint)

**One line:** Turnpike is a drop-in middleware that lets any API charge per request in QUSDC on QIE Mainnet, backed by a shared allowance contract so an autonomous software agent can pay only within limits its owner set and can revoke.

**Hackathon:** QIE Hackathon 3.0 (organiser: QIE Blockchain). **Deadline:** 30 Nov 2026, 23:59 CET (23:59 WAT). **Track:** see decision OD-1 in [17_FINAL_HANDOFF_AND_READINESS.md](17_FINAL_HANDOFF_AND_READINESS.md) — locked Stage 4.6 track is *AI + Autonomous Agents*; this package keeps it as default and decides finally by Nov 28.

**Readiness: CONDITIONALLY READY.** Implementation of the contract (M1) may begin immediately. Two gates must close first: DG-1 (differentiation, see [02](02_PRODUCT_VISION_AND_SCOPE.md)) by end of Nov 20, and RD-1 (contract reuse-vs-replace, see [09](09_IMPLEMENTATION_PLAN.md)) at the end of M1.

## 1. Primary objectives
1. Ship a working, publicly usable, mainnet-deployed product with verifiable on-chain evidence (hackathon rule HR-001, HR-005, HR-009).
2. Make the distinctive mechanism observable: *an agent pays and gets data; an over-cap payment is refused on-chain; a replayed payment is refused; the owner revokes and withdraws.*
3. Keep scope small enough to leave seven full build days and two days of hardening.

## 2. Scope summary
**In:** one multi-tenant allowance contract; Node/TypeScript middleware package with Express adapter; one mandatory paid endpoint (chain/address lookup) and one optional-priority endpoint (QIE Oracle price); scripted demo agent; one-page playground; evidence page; tests; docs.
**Out:** marketplace, multi-token, reputation, LLM-heavy agent, state channels, permit/gasless, ERC-4337, x402 compatibility layer, QIE Pass/ID checks, SignSafe features, fiat. See [02](02_PRODUCT_VISION_AND_SCOPE.md).

## 3. Core differentiator (provisional — gated by DG-1)
Seller-side drop-in: an API provider adds two lines of middleware and is paid per request; each payment is bound to one resource and one price by a server-issued, HMAC-derived `requestId`; the contract enforces owner-set limits independently of the agent; the gateway delivers each paid resource idempotently and is crash-safe. This is **not** a claim of novel agent spending limits (SpendGrid, a Hackathon 2 winner, and x402 exist) nor of QIE-unique cheapness.

## 4. Approved stack (details in [04](04_TECHNICAL_REQUIREMENTS_DOCUMENT.md))
Solidity 0.8.20 / Hardhat (TypeScript) / OpenZeppelin; Node.js LTS + TypeScript + Express + zod + better-sqlite3 + ethers v6; React + Vite playground; Docker deploy with a persistent volume; GitHub Actions CI.

## 5. Architecture at a glance
`Agent/Client → Gateway (Express + middleware) → QIE RPC (verify receipt) → deliver`; `Agent → Vault contract (pay) → Merchant`; `Owner (wallet) → Vault (policy, deposit, revoke, pause, withdraw)`. Full diagrams in [05](05_SYSTEM_ARCHITECTURE.md).

## 6. Repository structure (proposed)
```
turnpike/
  contracts/        Solidity + Hardhat tests
  packages/middleware/   core + express adapter
  apps/gateway/     demo server (paid endpoints, demo agent runner, state API)
  apps/playground/  React/Vite page
  scripts/          deploy, verify, mainnet-integration, evidence-export
  docs/             this package
  evidence/         tx hashes, exported run logs (no secrets)
```

## 7. Documentation index and reading order
| # | File | Purpose |
|---|---|---|
| 00 | this file | orientation |
| 01 | [01_HACKATHON_REQUIREMENTS.md](01_HACKATHON_REQUIREMENTS.md) | rules, rubric, mapping |
| 02 | [02_PRODUCT_VISION_AND_SCOPE.md](02_PRODUCT_VISION_AND_SCOPE.md) | scope, differentiation gate |
| 03 | [03_PRODUCT_REQUIREMENTS_DOCUMENT.md](03_PRODUCT_REQUIREMENTS_DOCUMENT.md) | FR/NFR with acceptance criteria |
| 04 | [04_TECHNICAL_REQUIREMENTS_DOCUMENT.md](04_TECHNICAL_REQUIREMENTS_DOCUMENT.md) | stack, interfaces, algorithms |
| 05 | [05_SYSTEM_ARCHITECTURE.md](05_SYSTEM_ARCHITECTURE.md) | diagrams, trust boundaries |
| 06 | [06_DATA_MODELS_AND_INTERFACES.md](06_DATA_MODELS_AND_INTERFACES.md) | contract ABI-level spec, HTTP API, DB |
| 07 | [07_USER_EXPERIENCE_AND_FLOWS.md](07_USER_EXPERIENCE_AND_FLOWS.md) | playground behaviour |
| 08 | [08_SECURITY_PRIVACY_AND_TRUST.md](08_SECURITY_PRIVACY_AND_TRUST.md) | invariants, threat model |
| 09 | [09_IMPLEMENTATION_PLAN.md](09_IMPLEMENTATION_PLAN.md) | milestones M0–M6 |
| 10 | [10_TESTING_AND_VERIFICATION_PLAN.md](10_TESTING_AND_VERIFICATION_PLAN.md) | test matrix, release gates |
| 11 | [11_DEVELOPMENT_SETUP_AND_DEPLOYMENT.md](11_DEVELOPMENT_SETUP_AND_DEPLOYMENT.md) | env, commands, deploy |
| 12 | [12_HACKATHON_DEMO_AND_SUBMISSION.md](12_HACKATHON_DEMO_AND_SUBMISSION.md) | demo script, checklist |
| 13 | [13_RISKS_ASSUMPTIONS_AND_DEPENDENCIES.md](13_RISKS_ASSUMPTIONS_AND_DEPENDENCIES.md) | risks, GO/NO-GO |
| 14 | [14_REQUIREMENTS_TRACEABILITY_MATRIX.md](14_REQUIREMENTS_TRACEABILITY_MATRIX.md) | traceability |
| 15 | [15_RESEARCH_SOURCES_AND_TECHNICAL_DECISIONS.md](15_RESEARCH_SOURCES_AND_TECHNICAL_DECISIONS.md) | evidence, decisions |
| 16 | [16_AGENT_IMPLEMENTATION_MASTER_PROMPT.md](16_AGENT_IMPLEMENTATION_MASTER_PROMPT.md) | prompt for the coding agent |
| 17 | [17_FINAL_HANDOFF_AND_READINESS.md](17_FINAL_HANDOFF_AND_READINESS.md) | open decisions, readiness |

**Reading order:** 17 → 02 → 03 → 08 → 06 → 04 → 05 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 (01 as reference).

## 8. Source-of-truth hierarchy
1. Official hackathon rules ([01](01_HACKATHON_REQUIREMENTS.md)) — always win.
2. Security invariants ([08](08_SECURITY_PRIVACY_AND_TRUST.md)) and contract interface ([06](06_DATA_MODELS_AND_INTERFACES.md)).
3. PRD ([03](03_PRODUCT_REQUIREMENTS_DOCUMENT.md)), then TRD ([04](04_TECHNICAL_REQUIREMENTS_DOCUMENT.md)), then architecture ([05](05_SYSTEM_ARCHITECTURE.md)).
4. Implementation plan and tests.
5. Anything else. A conflict must be reported, not silently resolved.

## 9. Evidence status (from the Stage 4 feasibility report, 2026-11-19)
Verified on QIE Mainnet with real transactions: chain ID 1990; ~3.632 s average block time; QUSDC is a 6-decimal ERC-20 with no transfer fee observed; approve/transferFrom behave; a minimal policy contract allowed a payment, refused an over-cap payment (`CapExceeded`) and a replay (`RequestAlreadyUsed`); 10/10 receipts retrievable. Proof-of-mechanism contract: `0x6910ac4bAA0A94EC9F28052F971566Dd6B57DdAC`. **That contract is not the final contract.** Known gaps: failed calls showed exactly 90,000 gas used (unexplained); finality/reorg behaviour untested; QUSDC has role-controlled mint/burn.

## 10. Orientation for a coding agent
Read [16](16_AGENT_IMPLEMENTATION_MASTER_PROMPT.md) first for operating rules. Never spend funds, deploy to mainnet, or publish anything without the approval step named there. Never mock a mandatory real integration (QIE RPC, QUSDC). Report blockers; do not invent facts.
