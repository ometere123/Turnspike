# PR #7 description (ready to paste)

Title: x402 v2 integration: `turnspike-allowance` scheme, `@turnspike-qie/x402`, hardened middleware 0.2.0

## What this is

x402 v2 support for Turnspike through a **registered custom scheme**, `turnspike-allowance`. A client pays `TurnpikeAllowance.pay` upfront on chain, then sends a `PAYMENT-SIGNATURE` payload `{requestId, txHash, sig}`. Stock `exact` clients cannot pay (QUSDC has no EIP-3009 or permit; Permit2 is not deployed on QIE Mainnet), so this is **x402 v2 compatible through a registered custom scheme, not universal or plug-and-play**. x402 v1 is refused.

Experimental and **unaudited**. No QIE testnet or mainnet run of the x402 flow has been done.

## Evidence

Tested commit: `406998a` plus the review-correction changes in the PR's newest commit (a commit cannot name its own hash; read the PR head, and its CI result on the PR itself). Everything through `406998a` is committed and pushed.

| Check | Result |
|---|---|
| GitHub CI, push and pull_request runs at `406998a` | **Both passed, every job, including the `regression` gate** |
| root `npx vitest run` | 9 files, 112 passed |
| `npx hardhat test` | 15 passing |
| `packages/x402` `npx tsc --noEmit` | exit 0 |
| `packages/x402` `npx vitest run` | 13 files, 161 passed |
| `packages/middleware` tests | 2 files, 35 passed |
| `packages/client` tests | 3 files, 48 passed |
| `node examples/x402-agent/run-local.mjs` | `X402 LOCAL DEMO OK` |
| `node examples/end-to-end/run.mjs` | `END-TO-END OK` |
| `node scripts/compat/turnspike1-diff.mjs` | `COMPAT OK` (12 steps; only the documented `Access-Control-Expose-Headers` delta) |

Counts at `406998a` were 160 x402 specs, 108 root vitest, 15 hardhat. The review corrections add 1 x402 spec and 4 middleware tests (counted in the root run). `rv4-lagging-rpc.spec.ts` is timing-sensitive: in some local runs its case (c) failed or the run ended with a teardown unhandled rejection (`evm_mine` after the provider was destroyed) although the other specs passed; it passed in both GitHub CI runs at `406998a`. Not changed here.

Details: `docs/x402/SECURITY_COMPAT_REPORT.md`. Local Hardhat only; not an audit.

## Compatibility with existing turnspike/1 deployments

- Default turnspike/1 behaviour is unchanged apart from the documented `Access-Control-Expose-Headers` addition (`exposeHeaders`, default on).
- **R1 (mount binding) is x402-only.** Challenge rows store the mount prefix (`req.baseUrl`); `x402Seller` and `mw.deliver` refuse a `PAYMENT-SIGNATURE` presented under another prefix. The turnspike/1 `X-PAYMENT` path never reads it. `packages/middleware/test/mount-legacy.test.ts` mounts one turnspike/1 instance under `/a` and `/b` (and a public-prefix and internal-root pair) and passes with identical results on `origin/main` (01c7f3b) and on this branch: `/a` to `/a`, `/a` to `/b`, `/b` to `/a` and a proxy prefix change are all accepted, as before. The 12-step compat diff cannot show this (single prefix); this test does.
- Consequence for x402: a reverse proxy that changes the mount prefix between the 402 and the retry is refused.

## Remaining limitations (unchanged)

- Not audited (O1). No testnet or mainnet run (O2). The testnet plan (`docs/x402/TESTNET_PLAN.md`) is **not yet approved**; nothing created, funded, signed or broadcast.
- The testnet run would use the clean optimised `TurnpikeAllowance` (3,570 bytes) and a labelled mock test token ("Turnspike Test USD", `tTUSD`). That is **not** byte-identical to the mainnet runtime (a 9,610-byte coverage-instrumented build; exact-runtime verification is evidence M9) and says nothing about the real mainnet QUSDC.
- O7: refunds for PAID_LATE payments are a design only; sellers must monitor `paidUndelivered()` and refund by hand.
- O5 (stale RPC plus a lagging local clock can let a client pay a late challenge), O6 (requestId griefing, accepted), RV-6 (a lost journal can cause one extra charge for the same purchase), RV-7 (distinct percent-encodings are refused, not crossed), O8 (one scheme, tested against `@x402/*` 2.31.0 only).
- Only the `turnspike-allowance` scheme; unmodified `exact` clients, wallets and marketplaces cannot pay until they add it.

## Test plan for reviewers

```bash
npx vitest run && npx hardhat test
(cd packages/x402 && npx tsc --noEmit && npx vitest run)
node examples/x402-agent/run-local.mjs && node examples/end-to-end/run.mjs
node scripts/compat/turnspike1-diff.mjs
```
