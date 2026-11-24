# x402 (PR #7): NO-GO for this release, closed without merge

Date: 2026-11-24. Reviewed head: `a92eaaa315f3055daf08b1bada542a50af312b60` on `feature/x402-v2-integration` (98 files, about 17,700 added lines). The branch is kept.

## Decision
**Not merged.** PR #7 is closed as deferred research. Turnspike claims no x402 support.

| Gate | Finding | Result |
|---|---|---|
| Public-network proof | No QIE testnet or mainnet x402 payment has been made. Every run is on a local chain with a mock token. The testnet plan (checkpoint A0) was never approved, so nothing could be funded or signed | fail |
| Interoperability | The scheme is custom (`turnspike-allowance`). An unmodified x402 `exact` client cannot pay: QUSDC on QIE has no EIP-3009 or permit, and Permit2 is not deployed on chain 1990. Tested only against `@x402/*` 2.31.0 | fail for any general x402 claim |
| Security review | Internal reviews only. Open: no outside audit (O1), refunds for late payments are a design only (O7), a lost journal together with a lost proof store can cost one extra charge (RV-6), an old block plus a lagging clock (O5) | not closed |
| Compatibility with `turnspike/1` | On the branch, the differential check reported no difference beyond one documented response header, and a mount-path test gave identical results on `main` and the branch. Its CI was green at the reviewed head | pass, local |
| Complexity and time | It would change the middleware, the store schema and the client a few days before the deadline, in the payment path, for a feature no existing client can use | not justified |

## What was carried over
Nothing. The fixes on that branch concern code that exists only there (canonical resource origin, mount binding, and `request_used_by_other_payer`), or change the published client's error contract. No defect in `main`'s payment path was found that required a cherry-pick. One useful item is test infrastructure only: that branch replaces a Windows-only process kill in the test setup; `main`'s CI is unaffected at its current size, and it is noted here for whoever resumes the work.

## To reopen
1. Owner approval of the testnet plan, then a testnet run with the recorded hashes.
2. A real client-to-seller payment on QIE, receipts inspected from two RPCs.
3. The O7 refund procedure implemented and rehearsed; an outside security review.
4. Documentation that keeps saying: a custom scheme, not plug-and-play `exact`.
