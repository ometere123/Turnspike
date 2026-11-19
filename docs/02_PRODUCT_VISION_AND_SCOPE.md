# 02 — Product Vision and Scope

## 1. Problem
1. **API sellers** cannot cheaply take per-request micro-payments from software callers: card rails have minimum fees and no machine identity.
2. **Owners of autonomous software agents** cannot safely give an agent money: a hot key with full balance means a bug or prompt-injection drains it.
Evidence status: both are widely discussed; no primary source gathered in this project (**UNVERIFIED**). Do not present them as measured facts in the submission; present them as the motivating scenario.

## 2. Users
- **Seller (API provider):** installs the middleware, receives QUSDC to a merchant address.
- **Owner (agent operator):** funds a bounded allowance account and can revoke/withdraw at any time.
- **Agent (software):** holds a key that can only call `pay`; has no authority over policy or funds.
- **Judge/visitor:** uses the public playground.

## 3. Current alternatives (honest)
x402-style HTTP payment protocols (other chains; QIE facilitator support **unverified**); SpendGrid (Hackathon 2 winner: organiser-reported "policy-governed payment-intent layer for treasuries, DAOs and AI agents"; code not reviewed); agent-wallet products with spending limits (reported by reviewers). Turnpike does not claim to invent agent spending limits.

## 4. Value proposition
A seller adds two lines of middleware and gets paid per request in QUSDC. An owner gives an agent a small, on-chain-enforced allowance. Every payment is single-use, bound to one resource and price, and delivery survives gateway crashes.

## 5. Differentiation gate (DG-1) — HARD APPROVAL GATE
Candidate distinguishing capabilities:
| ID | Capability | Needs verification |
|---|---|---|
| D1 | Limits are enforced **inside the settlement contract**, so even a malicious/compromised agent cannot exceed them (vs. pre-submission/off-chain policy checks) | Whether SpendGrid enforces on-chain (UNVERIFIED — its description says "before transactions reach the blockchain") |
| D2 | **Seller-side drop-in** with server-issued HMAC request IDs, single-use on-chain consumption, idempotent delivery and crash recovery | Whether SpendGrid/x402 facilitators cover seller-side delivery semantics (x402 does cover HTTP payment; the crash-safe delivery claim must be checked) |
| D3 | No admin/upgrade key in the contract; owner-only withdraw always available | — (verifiable from source) |

**Procedure (≤1 hour, by end of Nov 20):** read the organiser's Hackathon 2 retrospective and any public SpendGrid repo/docs; record findings in `docs/DIFFERENTIATION.md` (new file, developer-authored). **PASS** if at least one of D1/D2 holds after verification AND the one-sentence statement below survives. **FAIL** → stop, return to the Stage 4 decision (reserve: FairTicket needs a named event organiser; otherwise reopen discovery).
Provisional statement: *"Turnpike lets an API charge per request in QUSDC while the payer's spending limits are enforced by the settlement contract itself, and delivers each paid response exactly-once-or-cached even if the gateway crashes."* Do **not** claim "QIE-unique cheapness".

## 6. Goals / non-goals
Goals: G1 mainnet-verified end-to-end flow; G2 observable negative cases; G3 publishable package; G4 honest evidence page.
Non-goals: marketplace, multi-token, reputation, LLM sophistication (a scripted agent suffices), state channels, permit/gasless, ERC-4337, x402 interoperability layer, oracle-priced quotes, QIE Pass/ID verification, SignSafe-style simulation, fiat, token launch, governance, upgradeability, dashboards beyond one page.

## 7. In-scope functionality (summary; IDs in [03](03_PRODUCT_REQUIREMENTS_DOCUMENT.md))
Multi-tenant allowance contract (FR-001..FR-010); middleware (FR-011..FR-016); endpoints (FR-017, FR-018); demo agent + playground + evidence page (FR-019..FR-022).

## 8. Success criteria
- SC-1 All P0 requirements pass their release gates ([10](10_TESTING_AND_VERIFICATION_PLAN.md)).
- SC-2 The demo sequence runs on mainnet with real explorer links.
- SC-3 DG-1 passed and written down.
- SC-4 Submission checklist complete before 30 Nov 23:59 CET.
- SC-5 (stretch) ≥1 call from an address not controlled by the developer; report the real number only.

## 9. Post-hackathon (not required)
npm publish; multi-token; real merchant onboarding; audit; streaming payments.
