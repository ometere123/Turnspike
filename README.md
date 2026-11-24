# Turnspike

Autonomous agents pay for APIs per request in QUSDC on QIE Mainnet, while their owners keep spending limits the settlement contract enforces: a per-call cap, a daily cap, a merchant allowlist, pause and revoke. API providers add one middleware; agents use the SDK or the `turnspike` CLI. Built for QIE Hackathon 3.0 (track proposed by the owner: AI + Autonomous Agents; submission drafts in [`docs/submission/`](docs/submission/)).

**Judging this? Start with [`JUDGE.md`](JUDGE.md): a 60-second tour with links you can check yourself.**

Note: the deployed contract is a coverage-instrumented, unoptimised build (9,610 bytes) of the tested source, not the clean 3,570-byte build. Its exact runtime was reproduced and tested in `evidence/M9_deployed_bytecode_verification.md`; that is reproducibility evidence, not an audit. See `docs/OWNER_DECISIONS.md` D2.

Status: mainnet-deployed contract, tested gateway, middleware, SDK and CLI on npm, web console and playground. Unaudited. Not x402-compatible. Not production-ready. No external users yet.

```sh
npm i @turnspike-qie/middleware   # sellers (0.1.0)
npm i @turnspike-qie/client       # agents (0.1.1)
npx @turnspike-qie/cli --help     # operators (0.1.1)
```

## Live
- Web app, owner console, operations center, playground, docs and evidence: https://turnspike-qie.vercel.app (Next.js, `apps/web`). Which commit is live, and whether `/operations` is in it, is recorded in [`docs/RELEASE_CANDIDATE.md`](docs/RELEASE_CANDIDATE.md).
- Gateway API (Fly.io): https://turnspike-qie.fly.dev (`GET /v1/block-summary` returns a real 402 until paid)

## Mainnet deployment (chain 1990)
- Contract: [`0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c`](https://mainnet.qie.digital/address/0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c#code) (source verified on the explorer)
- Token: QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` (6 decimals)
- Transaction hashes and run output: [`evidence/`](evidence/)

## Integrate in two lines
```ts
import { turnspike } from "./packages/middleware/src";
app.use("/paid", turnspike({ rpcUrls, chainId: 1990, contract, token, merchant, hmacSecrets: [secret], dbPath, prices: { "/block-summary": 1000 } }));
```
Unpaid requests get HTTP 402 with a signed, expiring, resource-bound `requestId`. The caller pays through the contract, then retries with `X-Payment: base64({requestId, txHash, sig})`. The `sig` comes only from the 402 response and is the secret half of the proof; it is required on every redemption, including replays. The gateway checks the receipt (contract address, chain, merchant, request id, amount, confirmations, canonical block) and stores the response durably before sending it. The same proof returns the stored response. A payment mined before the challenge expired, or within 60 seconds after expiry (chain time), is honoured even if the proof arrives late.

## How it works
- `contracts/TurnpikeAllowance.sol`: multi-tenant vault. No admin, no upgrade, no rescue function. Checks, effects, then transfer; reentrancy guard.
- `packages/middleware`: challenge and HMAC, SQLite state machine (`ISSUED, PAID_PENDING, PAID_CONFIRMED, DELIVERED, EXPIRED, REJECTED`), receipt verification with RPC failover, Express adapter.
- `apps/gateway`: API server with two paid endpoints (`/v1/block-summary`, `/v1/address/:address`, 0.001 QUSDC each), status and stats endpoints, and a scripted demo agent protected by proof of work, per-visitor quotas and a shared daily transaction budget.
- `examples/express-api`: a runnable integration example that builds against the packaged middleware.
- `packages/middleware`, `packages/client`, `packages/cli`: published on npm as `@turnspike-qie/middleware`, `@turnspike-qie/client` and `@turnspike-qie/cli` (middleware 0.1.0; client and CLI 0.1.1, with the SDK payment-safety fixes, published 2026-11-19).
- `apps/web`: Next.js site and app (landing, product, owner console, operations, playground, developers, security, evidence, about). Run with `cd apps/web && npm install && npm run dev`.
- `apps/gateway-cf`: the gateway on Cloudflare Workers with a Durable Object ledger (staging only, payments off): [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md).
- `apps/web-e2e`: real-browser tests of the production build against a local chain, the real contract, a mock token and a real local gateway.

## Run and test
```
npm ci --legacy-peer-deps
npx hardhat test      # contract tests TEST-C01..C13, fuzz
npx vitest run        # middleware, gateway, demo guard, client SDK, CLI and web unit tests
node examples/end-to-end/run.mjs   # seller and agent on a local chain, after building packages/middleware and packages/client
node apps/web-e2e/run.mjs          # browser tests (local chain, test token); prerequisites are at the top of the file
```
On Windows without Visual Studio C++ build tools, add `--ignore-scripts` to `npm ci`/`npm install`: better-sqlite3 ships its compiled binary in the package, and npm otherwise tries to rebuild it. Current counts are in [`docs/RELEASE_QA.md`](docs/RELEASE_QA.md) and in CI.
Saved outputs are in `evidence/`. Environment variables: see `.env.example`. Secrets are never committed.

## Limitations and trust assumptions
Unaudited contract (deposit cap 5 QUSDC per account). QUSDC's issuer can mint and burn via a role. Daily limit uses fixed UTC days, so up to 2x the limit can pass across midnight UTC. Gateway is centralised; there is no refund for paid-but-undelivered requests, and a restored backup does not know challenges issued after it was taken (`docs/OPERATIONS.md`). Finality and reorg behaviour on QIE are untested. Reverted calls on QIE were charged exactly half their gas limit in 5 of 5 samples (a hypothesis, see `evidence/M6_gas_and_qusdc.md`). The comparison with SpendGrid and x402 is a draft in `docs/DIFFERENTIATION.md` (source notes in `docs/research/`); the project owner has not yet adopted it. AI assistance and the owner's own contributions are recorded in `docs/HUMAN_REVIEW_LOG.md`.

## Docs
Specification and plans are in [`docs/`](docs/).

License: MIT. Uses OpenZeppelin Contracts (MIT).

## More
Owner review: `OWNER_REVIEW_CHECKLIST.md`, `docs/OWNER_DECISIONS.md`. Review and verification results: `docs/CODEBASE_REVIEW.md`. First-time developer guide: `docs/DEVELOPER_ONBOARDING.md` (no external developer has completed it yet). Submission drafts: `docs/submission/`. Screenshots of the deployed site: `docs/screenshots/`.
