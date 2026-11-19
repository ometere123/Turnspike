# 13 — Risks, Assumptions and Dependencies

## 1. Risks
| ID | Risk | L | I | Mitigation / trigger |
|---|---|---|---|---|
| R1 | Differentiation judged insufficient vs SpendGrid/x402 | H | H | DG-1 hard gate; emphasise on-chain enforcement and delivery semantics |
| R2 | Schedule: 7 build days is tight | H | H | cut order; hard stops in [09](09_IMPLEMENTATION_PLAN.md) |
| R3 | Contract bug (new multi-tenant surface) | M | H | tests C01–C13, invariant fuzz, static analysis, second reviewer |
| R4 | Oracle feed address/decimals unverified | H | M | FR-018 is P1, fail-safe, cut |
| R5 | Reorg / finality unknown | M | M | TEST-X01; configurable confirmations |
| R6 | RPC outage | M | H | two RPCs, pending UX, recorded fallback |
| R7 | QUSDC admin actions (pause/blacklist/mint) | L | H | disclose; deposit cap |
| R8 | "Predominantly AI-generated" disqualification | M | H | developer writes/understands contract and commits; log contribution (OD-2) |
| R9 | No external usage for impact score | H | M | outreach to 1–2 builders; report honest numbers |
| R10 | Wallet (QIE Wallet) incompatibility | M | M | fallback injected provider; scripts for owner actions |
| R11 | Hosting downtime near deadline | M | H | deploy by Nov 27; fallback video |
| R12 | Failed-call 90,000 gas unexplained | M | L | TEST-X02 |
| R13 | Terms change (date inconsistency) | L | H | OD-6 |
| R14 | Funds lost from demo wallets | L | M | spend budget |

## 2. Assumptions
A1 QIE mainnet stays available. A2 explorer verification continues to work. A3 QIE Wallet supports chain switching (INT-005). A4 AI-assisted development is permitted if genuine developer contribution exists (rule detail not retrieved). A5 the second RPC mirrors the first. A6 an oracle feed exists for QIE/BTC/ETH (address unknown).

## 3. Dependencies
QIE RPC/explorer, QUSDC contract, OpenZeppelin libraries, hosting provider, npm registry, developer availability, wallets with funds.

## 4. Known limitations
L-1 unaudited. L-2 no refund for paid-but-undelivered requests. L-3 fixed-bucket daily cap permits up to 2× at midnight UTC. L-4 gateway centralised. L-5 not x402-compatible. L-6 merchant must trust gateway code; the contract cannot verify that a resource was delivered.
