# Turnspike

Drop-in middleware that lets an API charge per request in QUSDC on QIE Mainnet. Payers are bounded by a shared allowance contract: the owner sets per-call and daily limits for an agent key and can revoke, pause or withdraw at any time. Built for QIE Hackathon 3.0.

Status: mainnet-deployed contract, tested gateway and middleware, playground. Unaudited. Not x402-compatible. Not production-ready.

## Live
- Web app, playground, docs and evidence: https://turnspike-qie.vercel.app (Next.js, `apps/web`)
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
Unpaid requests get HTTP 402 with a signed, expiring, resource-bound `requestId`. The caller pays through the contract, then retries with `X-Payment: base64({requestId, txHash, sig})`. The `sig` comes only from the 402 response and is the secret half of the proof; it is required on every redemption, including replays. The gateway checks the receipt (contract address, chain, merchant, request id, amount, confirmations, canonical block) and stores the response durably before sending it. The same proof returns the stored response. A payment mined before the challenge expired, or within a 24 h grace window, is honoured even if the proof arrives late.

## How it works
- `contracts/TurnpikeAllowance.sol`: multi-tenant vault. No admin, no upgrade, no rescue function. Checks, effects, then transfer; reentrancy guard.
- `packages/middleware`: challenge and HMAC, SQLite state machine (`ISSUED, PAID_PENDING, PAID_CONFIRMED, DELIVERED, EXPIRED, REJECTED`), receipt verification with RPC failover, Express adapter.
- `apps/gateway`: API server with two paid endpoints (`/v1/block-summary`, `/v1/address/:address`, 0.001 QUSDC each), status and stats endpoints, and a scripted demo agent protected by proof of work, per-visitor quotas and a shared daily transaction budget.
- `examples/express-api`: a runnable integration example that builds against the packaged middleware.
- `packages/middleware`: the middleware as an installable package (`@turnspike-qie/middleware`, not published to npm yet).
- `apps/web`: Next.js site and app (landing, product, wallet app, playground, developers, security, evidence, about). Run with `cd apps/web && npm install && npm run dev`.

## Run and test
```
npm ci --legacy-peer-deps
npx hardhat test      # contract tests TEST-C01..C13, fuzz
npx vitest run        # middleware, gateway and demo-guard tests (39)
```
Saved outputs are in `evidence/`. Environment variables: see `.env.example`. Secrets are never committed.

## Limitations and trust assumptions
Unaudited contract (deposit cap 5 QUSDC per account). QUSDC's issuer can mint and burn via a role. Daily limit uses fixed UTC days, so up to 2x the limit can pass across midnight UTC. Gateway is centralised; there is no refund for paid-but-undelivered requests. Finality and reorg behaviour on QIE are untested. Reverted calls on QIE were charged exactly half their gas limit in 5 of 5 samples (a hypothesis, see `evidence/M6_gas_and_qusdc.md`). The comparison with SpendGrid and x402 is a draft in `docs/DIFFERENTIATION.md` (source notes in `docs/research/`); the project owner has not yet adopted it. AI assistance and the owner's own contributions are recorded in `docs/HUMAN_REVIEW_LOG.md`.

## Docs
Specification and plans are in [`docs/`](docs/).

License: MIT. Uses OpenZeppelin Contracts (MIT).
