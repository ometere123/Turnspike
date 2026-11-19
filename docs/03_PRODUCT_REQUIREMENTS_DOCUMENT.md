# 03 — Product Requirements Document

Priority: **P0** = required for submission; **P1** = should; **P2** = cut first. Status labels: VERIFIED / ASSUMED / REQUIRES EXECUTION TEST / BLOCKED.
Cut order (amendment 5): **second endpoint (FR-018) → oracle → presentation extras (FR-021 polish)**. Authorization, replay protection and critical negative tests are **never cut**.

## 1. Contract requirements (see [06](06_DATA_MODELS_AND_INTERFACES.md))
| ID | Requirement | Pri | Acceptance | Status |
|---|---|---|---|---|
| FR-001 | An owner can deposit QUSDC into their own account; deposits above a per-account deposit cap revert | P0 | TEST-C01 | Mechanism VERIFIED (Stage 4 deposits); cap REQUIRES EXECUTION TEST |
| FR-002 | Only the owner can set/change the agent's policy (per-call cap, daily cap, agent address). An agent address can never call policy functions | P0 | TEST-C02, SEC-001 | REQUIRES EXECUTION TEST |
| FR-003 | Only the owner manages the merchant allowlist; `pay` to a non-allowlisted merchant reverts | P0 | TEST-C03 | REQUIRES EXECUTION TEST |
| FR-004 | `pay(merchant, requestId, amount)` callable only by the account's active agent; transfers QUSDC from the owner's balance to the merchant and emits `Paid(owner, agent, merchant, requestId, amount)` | P0 | TEST-C04 | Single-account version VERIFIED on mainnet; multi-tenant REQUIRES EXECUTION TEST |
| FR-005 | Per-call cap and daily cap (fixed 24h bucket, `day = block.timestamp / 86400`) enforced atomically; exceeding reverts | P0 | TEST-C05, TEST-C06 | Per-call cap VERIFIED (CapExceeded on mainnet); daily REQUIRES EXECUTION TEST |
| FR-006 | A `(merchant, requestId)` pair can be consumed once on-chain; reuse reverts `RequestAlreadyUsed` | P0 | TEST-C07 | VERIFIED (replay rejected on mainnet, single-account) |
| FR-007 | Owner can revoke the agent immediately; revoked agent's `pay` reverts | P0 | TEST-C08 | REQUIRES EXECUTION TEST |
| FR-008 | Owner can pause/unpause their own account ("owner kill switch"). Pause blocks `pay` only; withdrawals remain allowed (decision DEC-3) | P0 | TEST-C09 | REQUIRES EXECUTION TEST |
| FR-009 | Owner can withdraw any of their unspent balance at any time (never blocked by pause, revoke or any other party) | P0 | TEST-C10 | REQUIRES EXECUTION TEST |
| FR-010 | View functions expose balance, policy, spent-today, used-request flag; all state changes emit events | P0 | TEST-C11 | REQUIRES EXECUTION TEST |
| FR-023 | Final contract deployed to QIE mainnet (chain 1990) with explorer-verified source and the address recorded in `evidence/` | P0 | TEST-D01 | BLOCKED until M2 |

DEC-1: no global admin, no upgradeability. A global kill switch would need an admin key, which creates a trust risk; the "kill switch" is per-owner (FR-008). This is a change-control note against the locked Stage 4.6 wording; recorded in [17](17_FINAL_HANDOFF_AND_READINESS.md).

## 2. Middleware / gateway requirements
| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-011 | Unpaid request → HTTP 402 with JSON challenge: `requestId` (HMAC-signed, expiring, bound to merchant, resource, amount, chainId, contract), price, contract, token, chain | P0 | TEST-M01 |
| FR-012 | Request with `X-Payment` (requestId + txHash) → server fetches receipt, verifies: tx succeeded, emitting contract == configured, chainId, `Paid.merchant`, `Paid.requestId`, `amount ≥ price`, confirmations ≥ configured depth | P0 | TEST-M02..M06 |
| FR-013 | Durable store (SQLite, persistent volume) with payment state machine (`ISSUED → PAID_PENDING → PAID_CONFIRMED → DELIVERED`, plus `EXPIRED`, `REJECTED`) | P0 | TEST-M07 |
| FR-014 | **One valid payment authorizes only its intended resource; no duplicate redemption; no unnecessary duplicate charge.** Re-presenting the same proof returns the stored response (idempotent replay) for the same resource; for any different resource it is refused. Crash after payment but before delivery: on retry with the same proof the gateway delivers (state `PAID_CONFIRMED`) without a new charge | P0 | TEST-M08, TEST-M09 |
| FR-015 | Pending-payment state: if receipt not found or confirmations insufficient, respond `202`/`402` with `status: pending` and `retryAfter`; confirmation depth configurable (default per [04](04_TECHNICAL_REQUIREMENTS_DOCUMENT.md)); no latency guarantee | P0 | TEST-M10 |
| FR-016 | Drop-in Express middleware: `app.use('/paid', turnpike({...}))`, config via env/object, resource price table | P0 | TEST-M11 |

## 3. Endpoints and clients
| ID | Requirement | Pri |
|---|---|---|
| FR-017 | Endpoint A (real, deterministic): `GET /v1/block-summary` — latest QIE block number/time/tx count read live from RPC; price 0.001 QUSDC | P0 |
| FR-018 | Endpoint B (cuttable): `GET /v1/price/:symbol` for BTC/ETH/QIE via QIE Oracle (`latestRoundData`). Fail-safe: before issuing a 402 challenge the gateway probes the feed; if the feed is missing, `answer ≤ 0`, older than `ORACLE_MAX_AGE_SECONDS`, or decimals are unverified, it returns `503 oracle_unavailable` with no challenge, so nothing is charged. If the oracle fails after payment, the paid requestId stays `PAID_CONFIRMED` and the caller may retry the same proof until the challenge expires; no fabricated or stale value is ever returned | P1 |
| FR-019 | Demo agent script: scripted (no LLM needed) agent obeying the 402 flow; demo steps in [12](12_HACKATHON_DEMO_AND_SUBMISSION.md) | P0 |
| FR-020 | Public playground (React): connect wallet, deposit, set policy, allowlist, revoke, pause, withdraw; run agent calls; live status | P0 |
| FR-021 | Evidence page: lists mainnet contract, tx links, negative-case proofs, honest usage counts from the gateway DB | P0 (polish P2) |
| FR-022 | Public landing/README snippets showing the 2-line integration | P1 |

## 4. Non-functional
| ID | Requirement |
|---|---|
| NFR-001 | UX never promises 3–6 s latency; pending state shown (observed receipt delay 3.0–6.4 s is VERIFIED but not guaranteed) |
| NFR-002 | Payment cost on mainnet is measured and reported, not claimed cheap-by-QIE |
| NFR-003 | Gateway uses two RPCs (`rpc1mainnet`, `rpc2mainnet`) with failover; second RPC is P1 and untested |
| NFR-004 | Contract build reproducible (pinned compiler 0.8.20, optimizer settings recorded) so explorer verification matches |
| NFR-005 | Structured logs of every payment state transition |
| NFR-006 | Gateway restart loses no state (volume) |
| NFR-007 | All work fits the schedule in [09](09_IMPLEMENTATION_PLAN.md); scope changes follow change control |

## 5. Deliberately not required
See non-goals in [02](02_PRODUCT_VISION_AND_SCOPE.md) §6.
