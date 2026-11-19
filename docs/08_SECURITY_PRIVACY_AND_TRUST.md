# 08 — Security, Privacy and Trust

## 1. Assets and actors
Assets: owner deposits, merchant revenue, HMAC secret, agent and deployer keys. Actors: owner, agent (possibly compromised or prompt-injected), seller, malicious caller, malicious merchant, RPC provider, QUSDC admin.

## 2. Threat model
| ID | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | Compromised agent drains account | per-call cap, daily cap, allowlist, deposit cap, revoke, pause (SEC-001..007, 013) | TEST-C02..C09 |
| T2 | Replay of payment proof | on-chain used key + gateway unique requestId/txHash (SEC-005) | TEST-C07, TEST-M08 |
| T3 | Payment used for another resource/price | HMAC binding + row check (SEC-003, 011) | TEST-M04, TEST-M05 |
| T4 | Forged `Paid` log from another contract | gateway checks emitting address and chainId (SEC-011) | TEST-M03 |
| T5 | Payment to wrong merchant | merchant in challenge and log compared | TEST-M06 |
| T6 | Reentrancy via token | nonReentrant + CEI (SEC-009) | TEST-C12 |
| T7 | Daily-cap race | atomic debit (SEC-002); bucket edge documented (SEC-006) | TEST-C05, C06 |
| T8 | Gateway crash between payment and delivery | state machine and recovery (FR-014) | TEST-M09 |
| T9 | Reorg invalidates payment | configurable confirmations; reorg REQUIRES EXECUTION TEST | TEST-X01 |
| T10 | HMAC secret leak | env-only, rotation procedure, short TTL | TEST-S01 |
| T11 | DoS on gateway/RPC | rate limits, timeouts, RPC failover (SEC-014) | TEST-M12 |
| T12 | Oracle stale/wrong data | fail-safe (FR-018) | TEST-M13 |
| T13 | QUSDC admin mints/burns/pauses | disclosed trust assumption (SEC-012); small deposit cap | TEST-X02 |
| T14 | Key leakage in repo | pre-commit secret scan, `.gitignore` | TEST-S02 |
| T15 | Front-running pay tx | requestId-keyed and merchant-bound; front-runner cannot redirect funds, only consume a user's ID with a different payer — mitigated because `pay` requires the owner's agent as `msg.sender` | TEST-C13 |

## 3. Privacy
No personal data collected beyond wallet addresses, IPs in rate-limit logs (retained ≤7 days). Public chain data is public. The playground does not store private keys. Demo agent key is a dedicated low-value key supplied by environment variable, never committed.

## 4. Trust assumptions disclosed in submission
1. QUSDC issuer can mint/burn via `VAULT_ROLE` (VERIFIED from source); pause/blacklist not verified.
2. The gateway operator is trusted by the seller only for delivery; funds never touch the gateway.
3. The contract is unaudited; deposit cap limits exposure.
4. Gateway availability is not decentralised.
5. Oracle feeds are third-party (QIE).
No claim of "audited", "trustless", or "production-ready" is made.

## 5. Operational security
Separate keys: deployer, demo owner, demo agent, merchant. Fund each with the minimum. Record addresses, never keys. Real funds require developer approval per [11](11_DEVELOPMENT_SETUP_AND_DEPLOYMENT.md).
