# 10 — Testing and Verification Plan

Rule: no document or demo may claim a test passed unless it was executed and logs saved to `evidence/`. Tests marked "mainnet" spend small real funds only after developer approval.

## 1. Contract tests (Hardhat, local)
| ID | Covers | Case |
|---|---|---|
| TEST-C01 | FR-001 | deposit ok; deposit over cap reverts |
| TEST-C02 | FR-002, SEC-001 | agent calls setPolicy/setMerchant/revokeAgent/setPaused/withdraw on owner's account — no effect on owner's account |
| TEST-C03 | FR-003 | non-allowlisted merchant reverts |
| TEST-C04 | FR-004 | valid pay moves funds, emits `Paid` |
| TEST-C05 | FR-005 | per-call cap exceeded reverts `CapExceeded` (boundary = cap passes, cap+1 fails) |
| TEST-C06 | FR-005, SEC-002, SEC-006 | daily cap; two payments in one block cannot jointly exceed; exact bucket-boundary test documents 2× behaviour |
| TEST-C07 | FR-006, SEC-005 | replay reverts; same requestId at a different merchant is a different key; no way to un-use |
| TEST-C08 | FR-007 | revoked agent reverts |
| TEST-C09 | FR-008, SEC-007 | paused: pay reverts, withdraw works |
| TEST-C10 | FR-009, SEC-004 | withdraw during pending pays; withdraw > balance reverts; pay after withdraw reverts |
| TEST-C11 | FR-010 | events and views correct |
| TEST-C12 | SEC-009 | malicious token / reentrancy attempt (test double, labelled mock) |
| TEST-C13 | T15 | non-agent caller reverts; cross-tenant: agent of owner A cannot spend owner B |
Plus: fuzz/invariant test: sum of balances + merchant receipts conserved; coverage report saved.

## 2. Gateway tests (Vitest, local chain or mainnet reads)
| ID | Covers |
|---|---|
| TEST-M01 | challenge shape, HMAC valid, TTL |
| TEST-M02 | valid proof delivers |
| TEST-M03 | log from wrong contract rejected |
| TEST-M04 | proof for resource X used on Y rejected |
| TEST-M05 | amount < price rejected |
| TEST-M06 | wrong merchant rejected |
| TEST-M07 | state machine transitions and unique constraints |
| TEST-M08 | same proof twice → same response, one DB row, no second charge |
| TEST-M09 | kill process after PAID_CONFIRMED before DELIVERED; restart; retry delivers |
| TEST-M10 | no receipt yet / under-confirmed → pending |
| TEST-M11 | drop-in integration in a sample Express app |
| TEST-M12 | rate limit; RPC1 down → RPC2 failover |
| TEST-M13 | oracle missing/stale/zero → `503`, no challenge, no fabricated data |

## 3. Deployment, mainnet and cross-cutting
| ID | Case | Status |
|---|---|---|
| TEST-D01 | deployed bytecode matches verified source; explorer shows verified | REQUIRES EXECUTION TEST |
| TEST-E01 | full demo sequence on mainnet (allowed, over-cap, replay, revoke, withdraw) | REQUIRES EXECUTION TEST |
| TEST-X01 | finality/reorg observation: record confirmations vs block hash stability over ≥50 blocks; set `CONFIRMATIONS` | REQUIRES EXECUTION TEST |
| TEST-X02 | QUSDC pause/blacklist inspection from source and read-only calls; 90,000-gas failed-call investigation | REQUIRES EXECUTION TEST |
| TEST-X03 | deploy with compiler default EVM vs berlin | REQUIRES EXECUTION TEST |
| TEST-S01 | HMAC secret rotation procedure works | |
| TEST-S02 | secret scan passes in CI | |
| TEST-S03 | `npm audit`/dependency review, Slither or equivalent static analysis, results saved | |

## 4. Release gates
G1 all TEST-C pass; G2 all TEST-M pass; G3 TEST-D01 + TEST-E01; G4 SEC checklist reviewed by a second human or an independent AI review recorded as such (not described as an audit); G5 submission checklist.
