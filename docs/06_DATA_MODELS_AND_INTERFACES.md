# 06 — Data Models and Interfaces

## 1. Contract state (DATA-001..)
| ID | Item | Definition |
|---|---|---|
| DATA-001 | `Account` per owner | `balance (uint256)`, `paused (bool)`, `agent (address)`, `perCallCap`, `dailyCap`, `dayIndex`, `spentToday` |
| DATA-002 | `allowedMerchant[owner][merchant]` | bool |
| DATA-003 | `usedRequest[merchant][requestId]` | bool; key is `(merchant, requestId)` so one request cannot be credited to two merchants |
| DATA-004 | `depositCap` | immutable constructor arg (base units per account) |
| DATA-005 | `token` | immutable QUSDC address |

## 2. Contract interface (specification, not code)
| Function | Caller | Effect |
|---|---|---|
| `deposit(amount)` | owner (any address acting for itself) | pulls QUSDC via `transferFrom`; reverts if balance would exceed depositCap |
| `setPolicy(agent, perCallCap, dailyCap)` | owner only (`msg.sender` account) | updates policy; resets nothing else |
| `setMerchant(merchant, allowed)` | owner | allowlist |
| `revokeAgent()` | owner | `agent = 0` |
| `setPaused(bool)` | owner | pause own account |
| `withdraw(amount)` | owner | reduces balance, transfers to owner; works while paused/revoked |
| `pay(owner, merchant, requestId, amount)` | agent of `owner` | checks in order: not paused, caller == account.agent, merchant allowed, amount ≤ perCallCap, daily bucket, not used, balance; then effects (mark used, update spent, debit), then transfer, then event |
| views | any | `account(owner)`, `isUsed(merchant, id)`, `spentToday(owner)` |

Note: because the contract is multi-tenant, `pay` takes the owner address (the Stage 4 single-owner `pay(merchant,requestId,amount)` becomes `pay(owner, merchant, requestId, amount)`). The emitted event is `Paid(owner, agent, merchant, requestId, amount)`.

Errors: `NotOwnerAgent`, `Paused`, `MerchantNotAllowed`, `CapExceeded(uint256 cap, uint256 attempted)`, `DailyCapExceeded(...)`, `RequestAlreadyUsed(bytes32)`, `InsufficientBalance`, `DepositCapExceeded`.
Required order: checks → effects → interaction; `nonReentrant`; `SafeERC20`.

## 3. Gateway data
| ID | Table | Fields |
|---|---|---|
| DATA-010 | `payments` | `requestId PK`, `resourceId`, `merchant`, `priceBase`, `chainId`, `contract`, `expiresAt`, `state`, `txHash UNIQUE NULL`, `blockNumber`, `payer`, `responseBody NULL`, `createdAt`, `updatedAt` |
| DATA-011 | `events` | append-only log of state transitions (NFR-005) |
| DATA-012 | `stats` view | counts for evidence page, split into own-controlled vs external addresses (a configured list of own addresses) |

## 4. HTTP interface (INT-006)
**402 challenge**
```json
{ "error": "payment_required", "requestId": "0x…", "sig": "…", "priceBase": "1000",
  "token": "0x3F43…5DA5", "contract": "0x…", "merchant": "0x…", "chainId": 1990,
  "resourceId": "block-summary", "expiresAt": 1735689600 }
```
**Proof header** `X-Payment: base64(JSON{requestId, txHash})`.
**Responses:** `200` data; `202 {status:"pending", retryAfter}`; `402` new challenge or invalid proof (`reason`); `403 wrong_resource`; `409 already_redeemed` only if resource differs; `410 expired`; `503 oracle_unavailable`/`rpc_unavailable`; `429`.
**Status:** `GET /v1/payments/:requestId` → `{state}` (no data).

## 5. Security invariants (specification — each has a test in [10](10_TESTING_AND_VERIFICATION_PLAN.md))
| ID | Invariant | Answer to amendment-3 question |
|---|---|---|
| SEC-001 | Agent cannot call `setPolicy`, `setMerchant`, `revokeAgent`, `setPaused`, `withdraw` for any account (functions act only on `msg.sender`'s own account) | An agent that is not an owner cannot change limits, allowlist or revocation. An agent that is also an owner of its *own* account can only affect that account. |
| SEC-002 | Daily cap is enforced in the same transaction that debits; EVM serial execution means two simultaneous requests cannot both pass if together they exceed the cap | Concurrent submissions: second reverts or lands in next bucket |
| SEC-003 | Used key is `(merchant, requestId)`; `pay` credits only the named merchant; gateway binds resource/price per row | Cross-merchant: impossible on-chain; cross-resource: refused by gateway |
| SEC-004 | `withdraw` and `pay` both read/write the same `balance`; checks-effects-interactions; `withdraw ≤ balance`; pause does not block withdraw | No inconsistent states: a pay that precedes withdraw succeeds, one that follows sees reduced balance and reverts |
| SEC-005 | A used requestId can never become valid again (no unset path) | Old IDs: permanently consumed |
| SEC-006 | Fixed UTC bucket (`block.timestamp / 86400`): owner may see up to 2× daily cap within a short window straddling midnight UTC. **Intentional and documented** (DEC-2); the per-call cap and balance still bound it | Boundary behaviour |
| SEC-007 | Pause blocks new `pay` only; withdraw always allowed (DEC-3) | Decision |
| SEC-008 | No admin, owner-of-contract, upgrade, or token rescue function | no hidden powers |
| SEC-009 | Reentrancy guard + SafeERC20; token is immutable QUSDC | |
| SEC-010 | Secrets only via env; `.gitignore`d; none in docs | |
| SEC-011 | Gateway verifies emitting contract, chainId, merchant, requestId, amount ≥ price | |
| SEC-012 | QUSDC trust assumptions disclosed (mint/burn role, unverified pause/blacklist) | |
| SEC-013 | Per-account deposit cap limits loss exposure | |
| SEC-014 | Rate limits and body size limits at gateway | |
