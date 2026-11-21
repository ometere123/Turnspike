# x402 v2 integration: security and compatibility verification report

Independent re-verification of branch `feature/x402-v2-integration` at commit `1548324` (fixes since `628dc0b`), plus the
small verifier fix listed below (uncommitted at the time of writing). This is not an audit. Nothing in this repository
has been audited.

## Claim

x402 v2 via the registered `turnspike-allowance` scheme; unmodified exact clients are not supported.

A client must register the `turnspike-allowance` scheme: it pays `TurnpikeAllowance.pay` upfront on chain, then sends a
`PAYMENT-SIGNATURE` payload `{requestId, txHash, sig}`. Stock `exact` clients cannot pay: QUSDC has no EIP-3009 and no
permit, and Permit2 is not deployed on QIE Mainnet (chain 1990).

## Environment

| Item | Value |
|---|---|
| Commit | `1548324` (base for the compat diff: `origin/main` `01c7f3b`) |
| OS | Windows 11 Pro 10.0.26200, Git Bash |
| Node | v22.23.3 |
| `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/extensions`, `@x402/fetch` | 2.31.0 (from `packages/x402/node_modules`) |
| Chain | local Hardhat node, chain 31337 only. No QIE testnet or mainnet transaction was sent |

## Reproduction

From the repository root, after `npm ci --legacy-peer-deps`, `npx hardhat compile` and `(cd packages/x402 && npm ci)`:

```bash
npx vitest run                                   # root suites
npx hardhat test                                 # contract tests
(cd packages/x402 && npx tsc --noEmit && npx vitest run)
(cd packages/x402 && npx tsc --noEmit -p ../../examples/x402-seller/tsconfig.json)
node examples/x402-agent/run-local.mjs           # expects "X402 LOCAL DEMO OK"
node examples/end-to-end/run.mjs                 # expects "END-TO-END OK"
node scripts/compat/turnspike1-diff.mjs          # turnspike/1 diff vs origin/main
```

## Results

| Command | Result |
|---|---|
| root `npx vitest run` | 108 passed, exit 0 |
| `npx hardhat test` | 15 passing, exit 0 |
| `packages/x402` `npx tsc --noEmit` | exit 0 |
| `packages/x402` `npx vitest run` | 74 passed (71 before the verifier fix + 3 new), exit 0 |
| example seller type-check | exit 0 |
| `node examples/x402-agent/run-local.mjs` | `X402 LOCAL DEMO OK`, exit 0 |
| `node examples/end-to-end/run.mjs` | `END-TO-END OK`, exit 0 |
| `node scripts/compat/turnspike1-diff.mjs` | exit 0; 12 steps, identical status codes and bodies; the only difference in every step is the new `access-control-expose-headers` header. Matches `docs/x402/TURNSPIKE1_COMPAT.md` |

## Threat model summary

- Agent key compromise: bounded by the vault's per-call cap, daily cap, merchant allowlist, pause and revoke.
- Seller tricked into delivering without payment: proofs are checked on chain (payer, merchant, amount, single-use
  `(merchant, requestId)`, confirmations, payment deadline) and the challenge fields echoed in `accepted.extra` must match
  the issued challenge (F2).
- Proof redirection: a proof for one resource presented for another is refused (`resource.url` and the stored
  `resourceId`).
- Header spoofing: `Host` and `X-Forwarded-*` must not change what a proof binds to.
- Client paying too late: the client refuses challenges whose payment deadline cannot be met (S7, N1).
- Out of scope: RPC provider honesty, chain reorgs deeper than the configured confirmations, host compromise.

## Fixed findings and how each was verified

| ID | Finding | Fix | Verification | Status |
|---|---|---|---|---|
| N1 | Stale RPC block plus a lagging local clock let the deadline check use a time that is too early | `deadlineReachable` adds `clockSkewSeconds` (default 15) when the latest block is older than `2 x expectedBlockTimeMs + 30 s` | Read the logic; `client-stale-block.spec.ts` covers fresh, threshold, stale, and skew 0. Edge cases reviewed: a block ahead of local time is used as the reference (correct); a block between ~7 s and 37 s old adds no margin (acceptable, it is within normal jitter); stale block and a local clock behind real time by more than `clockSkewSeconds` can still pass a late challenge (residual, see O5). The on-chain deadline check in the middleware remains the authority; a late payment is recorded as PAID_LATE, not delivered | Resolved, with residual O5 |
| N2/N3 | `resource.url` and trust-proxy origin built from the raw `Host` header | Documented `x402.resourceUrl` as required in production; example seller throws under `NODE_ENV=production` without `PUBLIC_ORIGIN` | Read `resourceUrlOf` (middleware) and `sameResource` (x402 seller). With `resourceUrl` set, the advertised and compared URL comes from the configured origin plus `req.originalUrl`; `Host` is not used. Without it, the comparison is path-only unless `trust proxy` is on, in which case the origin is compared against `protocol://Host`, where `Host` is client-controlled (documented, N3). The proof stays bound to the stored `resourceId`, so this affects what is advertised, not what a proof can buy. Enforcement is in the example only, not in the middleware (O4) | Resolved for the example; documented for the library |
| CI | No CI for `packages/x402` | New `x402` job: root `npm ci`, compile, `packages/x402` `npm ci`, `tsc --noEmit`, `vitest run`, agent demo | Read `.github/workflows/ci.yml`; commands match those run locally. The job has not been observed running on GitHub by this verifier | Resolved (not observed in CI) |
| Compat | No turnspike/1 behavioural diff | `scripts/compat/*`, `TURNSPIKE1_COMPAT.md` | Re-ran; output matches the committed document | Resolved; not in CI (O3) |
| Docs | GETTING_STARTED, SCHEME, READMEs, `deploy-local.mjs` | Edited | Reviewed the diff; `deploy-local.mjs` refuses any chain other than 31337 and uses only the public Hardhat test mnemonic | Resolved |
| V1 (verifier) | Example seller accepted a malformed `PUBLIC_ORIGIN` (no scheme, a path, a query, credentials). The result was an invalid or wrong `resource.url`, so every x402 payment would fail the resource check, or the advertised URL would carry a path | New `examples/x402-seller/src/origin.ts` (`normalizePublicOrigin`), used by `seller.ts` | New `packages/x402/test/seller-public-origin.spec.ts` (3 tests) | Fixed by verifier |

## Open findings and limitations

| ID | Severity | Item |
|---|---|---|
| O1 | High (process) | Not audited. Contracts, middleware, client and x402 package have had internal review only |
| O2 | High (process) | No QIE testnet or mainnet run of the x402 flow yet. Everything above ran on local Hardhat |
| O3 | Low | Addressed (not yet observed on GitHub): the CI `regression` job runs the compat script, which now exits non-zero on any difference outside the exposeHeaders delta (verified locally by injecting a body change: exit 1) |
| O4 | Medium | Addressed: the middleware, `x402Seller` and the scheme server fail closed at construction in production without a trusted public origin (`x402.publicOrigin` / `basePath` or a header-free resolver); `Host`, `X-Forwarded-*` and `trust proxy` never set the trusted origin; `resource.url` must equal the canonical URL. Tests: `o4-origin-config.spec.ts`, `o4-canonical-origin.spec.ts` |
| O5 | Low | N1 residual: a stale RPC and a local clock behind real time by more than `clockSkewSeconds` can still let the client pay a challenge that misses its deadline. The money then lands as PAID_LATE (below) |
| O6 | Medium | Global requestId griefing: `(merchant, requestId)` is single-use on chain, and a requestId seen in a 402 can be consumed by anyone who pays it first. An attacker can burn requestIds issued to others at their own cost, forcing the victim to re-quote. No funds are lost by the victim |
| O7 | Medium | Paid-but-undelivered (PAID_LATE): a payment verified on chain after the payment deadline is recorded as `REJECTED` with disposition `PAID_LATE` and not delivered. The money moved; there is no automatic refund. Sellers must monitor the 0.2.0 listing of paid-not-delivered payments and refund by hand |
| O8 | Info | Scope: only the `turnspike-allowance` scheme; x402 v1 payloads are refused; only QUSDC through `TurnpikeAllowance`; tested against `@x402/*` 2.31.0 only |

## Compatibility scope

- turnspike/1 clients: status codes and bodies unchanged for the 12 compat steps; responses gain
  `access-control-expose-headers`.
- x402 v2 clients: supported only when they register `turnspike-allowance` (as `@turnspike-qie/x402` does).
- Unmodified `exact` clients: not supported; they receive a 402 they cannot pay.
- x402 v1: refused with `unsupported_x402_version`.

## Verdicts

| Target | Verdict | Conditions |
|---|---|---|
| Experimental local release candidate | GO | Label it experimental and unaudited; state the claim above verbatim; keep O1 to O8 in the release notes |
| npm publication | NO-GO for now | Becomes GO after: the CI `x402` job is green on GitHub; the compat script runs in CI (O3); the middleware refuses or loudly warns at start-up when `x402` is on without `resourceUrl` in production (O4); a successful QIE testnet run of the agent demo (O2); package READMEs carry the claim and limitations; published as a pre-release (`0.x`, `next` tag) |
| Mainnet (chain 1990) | NO-GO | Requires all npm conditions, plus: an external audit of the vault, middleware and x402 settlement path (O1); a documented refund procedure and monitoring for PAID_LATE (O7); a mitigation or accepted-risk sign-off for requestId griefing (O6); a small capped mainnet pilot with low per-call and daily caps |
