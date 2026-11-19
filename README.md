# Turnpike

Drop-in middleware that lets an API charge per request in QUSDC on QIE Mainnet. Payers are bounded by a shared allowance contract: the owner sets per-call and daily limits for an agent key and can revoke, pause or withdraw at any time. Built for QIE Hackathon 3.0.

Status: mainnet-deployed contract, tested gateway and middleware, playground. Unaudited. Not x402-compatible. Not production-ready.

## Mainnet deployment (chain 1990)
- Contract: [`0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c`](https://mainnet.qie.digital/address/0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c#code) (source verified on the explorer)
- Token: QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` (6 decimals)
- Transaction hashes and run output: [`evidence/`](evidence/)

## Integrate in two lines
```ts
import { turnpike } from "./packages/middleware/src";
app.use("/paid", turnpike({ rpcUrls, chainId: 1990, contract, token, merchant, hmacSecrets: [secret], dbPath, prices: { "/block-summary": 1000 } }));
```
Unpaid requests get HTTP 402 with a signed, expiring, resource-bound `requestId`. The caller pays through the contract, then retries with `X-Payment: base64({requestId, txHash})`. The gateway checks the receipt (contract address, chain, merchant, request id, amount, confirmations) and delivers once. The same proof returns the stored response; a crash between payment and delivery is recovered on retry.

## How it works
- `contracts/TurnpikeAllowance.sol`: multi-tenant vault. No admin, no upgrade, no rescue function. Checks, effects, then transfer; reentrancy guard.
- `packages/middleware`: challenge and HMAC, SQLite state machine (`ISSUED, PAID_PENDING, PAID_CONFIRMED, DELIVERED, EXPIRED, REJECTED`), receipt verification with RPC failover, Express adapter.
- `apps/gateway`: demo server with `/v1/block-summary` (live QIE block data, 0.001 QUSDC), status and stats endpoints, and a scripted agent.
- `apps/playground`: React page for owner actions, scripted agent runs and evidence.

## Run and test
```
npm ci --legacy-peer-deps
npx hardhat test      # contract tests TEST-C01..C13, fuzz
npx vitest run        # gateway tests TEST-M01..M13, S01, endpoint and agent
```
Saved outputs are in `evidence/`. Environment variables: see `.env.example`. Secrets are never committed.

## Limitations and trust assumptions
Unaudited contract (deposit cap 5 QUSDC per account). QUSDC's issuer can mint and burn via a role. Daily limit uses fixed UTC days, so up to 2x the limit can pass across midnight UTC. Gateway is centralised; there is no refund for paid-but-undelivered requests. Finality and reorg behaviour on QIE are untested. Failed calls on QIE show a fixed gas charge that is not yet explained. Comparison with SpendGrid and x402 is in `docs/DIFFERENTIATION.md` (to be written by the project owner).

## Docs
Specification and plans are in [`docs/`](docs/).

License: MIT. Uses OpenZeppelin Contracts (MIT).
