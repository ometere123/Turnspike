# Codebase review and verification, HEAD of `main` plus this branch (2026-11-19)

Scope: contract, middleware, gateway, client SDK, CLI, web app, examples, tests, CI, deployment and docs. Method: read the source of the middleware, store, verifier, gateway server, client SDK and CI; ran every test suite; exercised the live deployments. The contract was reviewed through its tests and the existing static-analysis record, not re-audited line by line, and **no external audit exists**.

## Verification results (this machine, Windows 11, Node 22.23, 2026-11-19)
| Check | Result |
|---|---|
| `npx hardhat test` | 15 passing (local Hardhat chain, mock ERC-20) |
| `npx vitest run` | 74 passing in 5 files (73 before this review plus CL-11b); local chain, never mainnet |
| `npx tsc -p tsconfig.build.json --noEmit` | clean |
| `node examples/end-to-end/run.mjs` | `END-TO-END OK`: pay, replay without second charge, 400 before quote, price ceiling refusal. **Local Hardhat chain with a test token; not a mainnet transaction** |
| `apps/web` typecheck, lint, production build | all clean; 13 static pages; routes `/`, `/about`, `/app`, `/developers`, `/evidence`, `/playground`, `/product`, `/security` |
| `npm audit --omit=dev --audit-level=high` (root and `apps/web`) | 0 vulnerabilities |
| Packages built (`tsc`) | middleware, client, cli build |
| Published packages | `npm view`: client, middleware, cli all 0.1.0. Clean `npm i` in an empty dir installed all three; `turnspike --help` runs |
| Gateway `https://turnspike-qie.fly.dev` | `/healthz` `{"ok":true}`; `/v1/config` shows chain 1990, contract 0xa2f2…5d9c, QUSDC 0x3F43…5DA5; `/v1/block-summary` returns 402 |
| Live site routes | all 8 return 200 |
| Browser (Chrome headless screenshots, built-in browser emulation at 375 px) | all checked routes render; no horizontal overflow at 375 px on `/`, `/app`, `/playground`, `/developers`, `/evidence`; one `h1` on home; no images without alt on home |
| Environment note | `npm ci` without `--legacy-peer-deps` fails (lock out of sync with hardhat peer ranges); CI and docs use `--legacy-peer-deps`. `better-sqlite3` had no prebuilt binary build step on this machine, so tests ran against a copy of the main checkout's installed `node_modules` |

**Not run:** Lighthouse (no tool installed here; the last recorded run is `evidence/M7_lighthouse.md`, dated earlier, so treat it as historical), the paid mainnet demo (forbidden by the brief), tablet and mobile screenshots saved to disk (headless Chrome clips below 500 px; emulated viewport checks were done by script instead), assistive-technology testing, cross-browser testing (Chrome only).

## Status by area
| Area | Implemented | Tested | On mainnet | In a real browser | Public | Incomplete / unverified |
|---|---|---|---|---|---|---|
| Contract | yes | 15 tests incl. fuzz and reentrancy | deployed, allowed, over-cap, replay and revoke txs in `evidence/` | n/a | explorer | unaudited; no `ReentrancyGuard` reliance on token honesty is mock-tested only; QUSDC issuer can mint and burn |
| Middleware | yes | gateway and middleware suites incl. crash, lease, expiry, reconcile | via gateway, evidence M4 to M8 | n/a | npm 0.1.0 | single SQLite file per seller; no multi-region |
| Gateway | yes | 7 tests | live on Fly | n/a | yes | single machine; demo guard thresholds untested at scale |
| Client SDK | yes | 17 tests with real middleware and contract | one real purchase and replay (M8) | n/a | npm 0.1.0 (pre-fix) | needs 0.1.1 |
| CLI | yes | 10 tests | read-only commands on mainnet | n/a | npm 0.1.0 | pay path mainnet-tested only through SDK example |
| Web | yes | typecheck, lint, build | calls live gateway | verified by script and screenshots | Vercel | no automated browser tests in CI; no screen-reader pass |
| Examples | yes | CI builds; e2e passes | node-agent bought on mainnet | n/a | repo | express example not run on mainnet |
| Docs | extensive | n/a | n/a | n/a | repo | several historical docs (00 to 17) still describe plans; see "Doc reconciliation" |

## Defects found and fixed in this review
1. **Client `resume()` could pay an expired challenge** (`packages/client/src/client.ts`). A journal record in state `challenged` (never broadcast) was paid on resume without any expiry check. The seller rejects a payment mined after expiry plus grace, so the payer would spend QUSDC and gas for nothing. Fix: refuse and mark the record failed when the challenge is within `minSecondsToExpiry` of expiry. Regression test CL-11b. Not yet in a published package (D4).
2. **Gateway `/v1/qusdc-activity` top counterparties** ordered with `Number()` of a bigint difference, which loses precision above 2^53 base units and could mis-order large counterparties. Fixed with bigint comparison.
3. **Documentation drift**: README and `HUMAN_REVIEW_LOG.md` claimed a 24 h payment grace while the code and package README use 60 s; README test counts were stale; `docs/12` gave a deadline of 18:00 CET while the live page says 23:59 CET. Corrected.

## Rechecked and found sound
- **Expiry and deadline:** judged on chain time of the mined block, with grace; a proof arriving late after an outage is still honoured (verify.ts).
- **Retention and reconciliation:** unpaid rows purge only after reconcile has covered the deadline; rows with a transaction are never purged; reconcile advances its high-water mark only to the confirmed head.
- **Leases:** token-fenced claim, renew, complete and release; stale holders cannot overwrite.
- **Request binding:** the signed requestId covers merchant, resourceId, price, chain, contract and expiry; method, sorted query, optional body hash and caller identity are folded into resourceId; a proof for another resource returns 403.
- **Payer identity:** the Paid log's owner and agent are recorded; `allowedOwners` and `allowedAgents` optional. By design the proof is a bearer capability (documented; do not put per-customer private data behind a route without an identity binding).
- **Response fidelity:** byte-exact base64 storage, allowlisted headers only, length recomputed; streaming responses unsupported and documented.
- **Concurrency:** one atomic SQLite transaction per transition; duplicate redemption yields `already_redeemed` or a pending reply; unique txHash.
- **RPC failures:** failover per query using one provider for a consistent snapshot; `503 rpc_unavailable`, never a rejection; SQLite failures map to 503.

## Observations not fixed (recorded, low risk or out of scope)
- The in-memory rate limiter is per process and keyed by `req.ip`; behind a proxy this depends on `trust proxy`. The gateway sets it to 1 (correct for Fly). Sellers behind other proxies must set it.
- A handler that never ends keeps its lease-renewal timer alive until the process restarts.
- `reconcile()` takes a 50,000-block lookback on first run only; a seller down longer than that on first start could miss payments (documented in operations).
- The `EXPIRED` state exists in the type but is never written.
- Daily cap 2x across UTC midnight; no refunds; QUSDC issuer powers; reorg and finality behaviour on QIE are untested beyond the observation in `evidence/M6_finality_observation.md`.

## Blocking, important, optional
- **Blocking for a claim of "ready":** none in the code. Blocking for submission: the owner's decisions (track, PASS/FAIL, submission form), a recorded demo video, and the owner's own contribution log.
- **Important:** publish client 0.1.1; run Lighthouse and a screen-reader pass; get one external developer through `docs/DEVELOPER_ONBOARDING.md`; verify SpendGrid claims.
- **Optional:** browser tests in CI; shared rate limiter; x402 adapter.

## Readiness score (recomputed from evidence)
| Category | Weight | Score | Evidence |
|---|---|---|---|
| Correctness and security of core | 25 | 21 | all suites pass, one real defect found and fixed; contract unaudited, issuer risk |
| Live deployment and mainnet proof | 15 | 13 | gateway, site, contract live; real SDK purchase and replay recorded; single machine |
| Tests and CI | 10 | 9 | 89 automated tests; no browser tests |
| Docs accuracy | 10 | 8 | drift fixed; historical numbered docs still plan-shaped |
| SDK and CLI onboarding | 10 | 6 | published and installable; no external developer has completed it |
| Differentiation and adoption evidence | 10 | 4 | combination claim plausible, undecided by owner, SpendGrid unverified, zero external users |
| Visual and product quality | 10 | 8 | consistent redesign, no overflow at 375 px; no accessibility audit |
| Submission package | 10 | 5 | drafts complete; no video, track undecided, nothing submitted |
| **Total** | **100** | **74** | previous informal estimate ~77%; lower because adoption and submission items are weighed explicitly |
