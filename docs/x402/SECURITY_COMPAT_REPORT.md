# x402 v2 integration: security and compatibility verification report

Independent re-verification of branch `feature/x402-v2-integration` (PR #7). Final tested state: commit `406998a` plus the
review-correction commit that follows it (the PR's newest commit; its CI result is shown on the PR, not claimed here). Everything through `406998a`
is committed and pushed. This is not an audit. Nothing in this repository has been audited.

**GitHub CI:** both runs (push and pull_request) at `406998a` passed, every job including the `regression` gate.

## Claim

x402 v2 via the registered `turnspike-allowance` scheme; unmodified exact clients are not supported.

A client must register the `turnspike-allowance` scheme: it pays `TurnpikeAllowance.pay` upfront on chain, then sends a
`PAYMENT-SIGNATURE` payload `{requestId, txHash, sig}`. Stock `exact` clients cannot pay: QUSDC has no EIP-3009 and no
permit, and Permit2 is not deployed on QIE Mainnet (chain 1990).

## Environment

| Item | Value |
|---|---|
| Commit | `406998a` plus the review-correction commit that follows it, i.e. the PR's newest commit (base for the compat diff: `origin/main` = `01c7f3b`) |
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
| root `npx vitest run` | 9 files, 112 passed, exit 0 (108 at `406998a` plus the 4 new `mount-legacy.test.ts` cases) |
| `npx hardhat test` | 15 passing, exit 0 |
| `packages/middleware` and `packages/client` tests | middleware 2 files, 35 passed (includes the 4 new mount-legacy cases); client 3 files, 48 passed |
| New `packages/middleware/test/mount-legacy.test.ts` against `origin/main` (01c7f3b) middleware (`MW_ENTRY`) | 4 passed: same results as this branch |
| `packages/x402` `npx tsc --noEmit` | exit 0 |
| `packages/x402` `npx vitest run` | 13 files, 161 passed (160 at `406998a` plus 1 new X-PAYMENT case in `r1-mount-binding.spec.ts`). On the Windows verification machine the process exited 1 in two full runs because of one unhandled rejection at teardown in the unchanged `rv4-lagging-rpc.spec.ts` (`evm_mine` after the provider was destroyed); that spec's case (c) also failed in some isolated local reruns (timing-sensitive). Neither was seen in GitHub CI at `406998a` (all green). Not changed here |
| example seller type-check | exit 0 |
| `node examples/x402-agent/run-local.mjs` | `X402 LOCAL DEMO OK`, exit 0 |
| `node examples/end-to-end/run.mjs` | `END-TO-END OK`, exit 0 |
| `node scripts/compat/turnspike1-diff.mjs` | `COMPAT OK`, exit 0: no difference outside the documented `access-control-expose-headers` delta |
| `npm ci --dry-run --offline` at the root (`--legacy-peer-deps`), `packages/x402`, `middleware`, `client`, `cli` | each lockfile is in sync with its `package.json` |

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
| CI | No CI for `packages/x402` | New `x402` job: root `npm ci`, compile, `packages/x402` `npm ci`, `tsc --noEmit`, `vitest run`, agent demo | Read `.github/workflows/ci.yml`; commands match those run locally. Observed on GitHub: green at `406998a` (push and pull_request) | Resolved |
| Compat | No turnspike/1 behavioural diff | `scripts/compat/*`, `TURNSPIKE1_COMPAT.md` | Re-ran; output matches the committed document | Resolved; also runs in the CI `regression` job (O3). It covers one mount prefix only: see R1 |
| Docs | GETTING_STARTED, SCHEME, READMEs, `deploy-local.mjs` | Edited | Reviewed the diff; `deploy-local.mjs` refuses any chain other than 31337 and uses only the public Hardhat test mnemonic | Resolved |
| V1 (verifier) | Example seller accepted a malformed `PUBLIC_ORIGIN` (no scheme, a path, a query, credentials). The result was an invalid or wrong `resource.url`, so every x402 payment would fail the resource check, or the advertised URL would carry a path | New `examples/x402-seller/src/origin.ts` (`normalizePublicOrigin`), used by `seller.ts` | New `packages/x402/test/seller-public-origin.spec.ts` (3 tests) | Fixed by verifier |

## Open findings and limitations

| ID | Severity | State | Item |
|---|---|---|---|
| O1 | High (process) | Open | Not audited. Contracts, middleware, client and x402 package have had internal review only |
| O2 | High (process) | Open | No QIE testnet or mainnet run of the x402 flow. Everything above ran on local Hardhat. The testnet plan (`docs/x402/TESTNET_PLAN.md`) is prepared and **not yet approved (checkpoint A0)**; nothing has been executed: no keystore created, no transaction signed, no faucet request, no account funded. The plan deploys the clean optimised build (3,570 bytes, not byte-identical to the 9,610-byte instrumented mainnet runtime) and a labelled mock test token (`tTUSD`), so a pass would demonstrate the x402 workflow on QIE testnet, not the real mainnet QUSDC or the deployed mainnet bytecode |
| O3 | Low | Addressed; CI green on GitHub at `406998a` (push and pull_request, every job including `regression`) | CI `regression` job (`shell: bash`, so `-eo pipefail`): `npm ci` in every package that has a lockfile, the compat diff (exits 1 on any difference outside the exposeHeaders delta), x402 `tsc` and specs, middleware, client and root vitest, hardhat, both demos. All lockfiles verified in sync with `npm ci --dry-run`. Residual: the example apps (`examples/express-api`, `node-agent`) and the older jobs still use `npm install`; `npm audit --audit-level=high` can fail on a new advisory without any code change |
| O4 | Medium | Addressed (review fixes RV-1, RV-2, RV-3, RV-5) | Fail closed: with x402 on and no trusted public origin or header-free resolver, construction throws unless `NODE_ENV` is `development` or `test` (an unset `NODE_ENV` is production, after the review). `Host`, `X-Forwarded-*` and `trust proxy` never set the trusted origin; the advertised `resource.url`, the requested resource and the signed `resourceId` stay bound. turnspike/1-only deployments never build the policy. Tests: `o4-origin-config.spec.ts`, `o4-canonical-origin.spec.ts`, `o4-review-fixes.spec.ts`. Residual: `production: false` is an explicit opt-in to the development fallback (path and query compared only, origin untrusted) |
| O5 | Low | Open | N1 residual: a stale RPC and a local clock behind real time by more than `clockSkewSeconds` can still let the client pay a challenge that misses its deadline. The money then lands as PAID_LATE |
| O6 | Low (accepted) | Accepted, F1 fixed | Global requestId griefing: an attacker can burn requestIds at its own cost (1 base unit plus gas); the victim loses at most one reverted `pay` of gas. F1 (client): a request mined as reverted because another payer used the requestId first is marked `request_used_by_other_payer`, not charged, with one fresh-challenge retry. A missing receipt, a changed block hash or a reorg stays `maybePaid`. See `docs/x402/O6_REQUESTID_GRIEFING.md` |
| O7 | Medium | Design only | Paid-but-undelivered (PAID_LATE): money moved, no automatic refund. `docs/x402/O7_LATE_PAYMENT_REFUNDS.md` is a design; nothing is implemented. Sellers must monitor `paidUndelivered()` and refund by hand |
| O8 | Info | Open | Scope: only the `turnspike-allowance` scheme; x402 v1 refused; QUSDC through `TurnpikeAllowance` only; tested against `@x402/*` 2.31.0 only |
| R1 | Medium | Fixed for x402; turnspike/1 unchanged | A proof could cross mounts of one middleware instance (same relative `resourceId` under `/a` and `/b`). Rows now store the mount (`req.baseUrl`) and the **x402** path (`x402Seller`, `mw.deliver`) refuses a presentation from another mount. Test: `r1-mount-binding.spec.ts`. **The turnspike/1 `X-PAYMENT` path does not read the stored mount and is unchanged from `origin/main`**: this was previously misstated here as also enforced on turnspike/1. Verified by `packages/middleware/test/mount-legacy.test.ts` (one turnspike/1 instance under `/a` and `/b`, plus a public-prefix and internal-root pair): paid under `/a` redeemed under `/a` works; `/a` to `/b`, `/b` to `/a` and a proxy prefix change are all accepted, identically on `origin/main` (01c7f3b) and on this branch. The 12-step compat diff cannot establish this (it never mounts one instance under two prefixes). So R1 changes no previously working turnspike/1 behaviour, and turnspike/1 still has the cross-mount weakness on main (documented; use one middleware per mount or distinct `resourceId` per rule). Residual for x402: rows written before the column existed have a null mount and are not checked (they expire within the challenge TTL plus payment grace); an x402 challenge must be presented under the mount it was issued under, so a reverse proxy that changes the prefix between 402 and retry is refused |
| RV-1 | Medium | Fixed in review | An unset `NODE_ENV` selected the development fallback, so a server started without `NODE_ENV` silently skipped the O4 check. Production is now the default (`defaultProduction()`: only `development` and `test` are non-production) |
| RV-2 | Low | Fixed in review | The resolver header guard could be bypassed through `Object.getOwnPropertyDescriptor(req.headers, "host")`, `req.res.req.headers.host` and `req.socket.parser.incoming` (and `req.connection`, `req.client`) |
| RV-3 | Low | Fixed in review | The resolver result was compared at the second `?` of the query, so a query containing `?` was only compared up to it |
| RV-4 | Medium | Fixed in review | F1 classification read `isUsed` and scanned the Paid logs at different heights. On a lagging or load-balanced RPC the owner's own competing payment could be missed and the key closed as not charged, inviting a second charge. The F1 branch now re-reads `isUsed` and scans at one block height, and re-checks the receipt afterwards; anything else stays `maybePaid` |
| RV-5 | Low | Fixed in review | `normalizeOrigin` accepted port 0 |
| RV-6 | Low | Open (documented) | `already_paid` before broadcast is treated as not charged, with one fresh-challenge retry. If the same owner had already paid that exact challenge from another process or journal whose records are lost, the retry buys a new challenge: a second charge for the same logical purchase, though no record of the first exists. Bounded to one retry per call |
| RV-7 | Info | Open (documented) | Distinct percent-encodings of one path (`%7e` and `%7E`) produce different canonical URLs. They are matched exactly, never crossed, so this is a refusal, not a bypass. `;` parameters are part of the path and route as Express routes them |
| RV-8 | Info | Noted | TEST-M09 was made deterministic (a 600 s lease in the fixture, then the dead process's `leaseUntil` moved into the past). Its assertions are intact: `early` still gets 202 `delivering` while the dead lease is live, and the retry still gets 200 with the same body and a single handler run. The RC-1 test under `trust proxy` now asserts the O4 behaviour (origin untrusted; path, query and `resourceId` still bound), a deliberate change |

Probed with no bypass found: `normalizeOrigin` (uppercase, default and explicit ports, IPv6 including `[::ffff:127.0.0.1]`, punycode, `http://localhost.evil.com`, `0.0.0.0`, trailing dots, userinfo, whitespace, lists, wildcards); path canonicalisation (`%2e`, `%2f`, `%5c` in any case, double-encoded, raw non-ASCII, dot segments, fragments, absolute-form targets); every read of Host outside the development fallback.

## Compatibility scope

- turnspike/1 clients: status codes and bodies unchanged for the 12 compat steps; responses gain
  `access-control-expose-headers`. Mount-prefix behaviour (one instance under several prefixes) is unchanged from `origin/main`, shown by `mount-legacy.test.ts` (the 12-step diff alone cannot show it).
- x402 v2 clients: supported only when they register `turnspike-allowance` (as `@turnspike-qie/x402` does).
- Unmodified `exact` clients: not supported; they receive a 402 they cannot pay.
- x402 v1: refused with `unsupported_x402_version`.

## Verdicts

| Target | Verdict | Conditions |
|---|---|---|
| Experimental local release candidate | GO | Label it experimental and unaudited; state the claim above verbatim; keep the open findings in the release notes |
| npm publication (pre-release, `0.x`, `next` tag) | NO-GO for now | Becomes GO after: (the CI `regression` and `x402` jobs were observed green on GitHub at `406998a`, O3 satisfied); a successful QIE testnet run of the agent demo following `TESTNET_PLAN.md` (O2; the plan is **not yet approved** and nothing has been run, and the run uses a mock test token and the clean optimised build, not the mainnet runtime); package READMEs carry the claim and limitations (the review fixes are committed and pushed as of `406998a`). O4 is no longer a blocker |
| Mainnet (chain 1990) | NO-GO | Requires all npm conditions, plus: an external audit of the vault, middleware and x402 settlement path (O1); an implemented and tested refund procedure and monitoring for PAID_LATE (O7, design only today); owner sign-off on O6 (accepted, low); a small capped mainnet pilot with low per-call and daily caps |
