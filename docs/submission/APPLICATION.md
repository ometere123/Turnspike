# QIE Hackathon 3.0 application: Turnspike (draft copy for the submission form)

**Draft. Not submitted.** The owner edits and submits this through the authenticated form at hackathon.qie.digital. Re-check every field against the live form before pasting; field names below are the ones the official pages describe (repository, live demo URL, mainnet contract address, track), plus the descriptive text most forms ask for. Every number here comes from `evidence/`, the npm registry or the live gateway, checked on 2026-11-19.

## Form fields
| Field | Value |
|---|---|
| Project name | Turnspike |
| Track | AI + Autonomous Agents |
| GitHub repository | https://github.com/ometere123/Turnspike (public, MIT) |
| Live demo URL | https://turnspike-qie.vercel.app |
| Live API gateway | https://turnspike-qie.fly.dev (paid routes answer HTTP 402) |
| Mainnet contract address | `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` (`TurnpikeAllowance`, source verified on the explorer: https://mainnet.qie.digital/address/0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c#code) |
| Network | QIE Mainnet, chain id 1990; token QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` (6 decimals) |
| npm packages | `@turnspike-qie/middleware` 0.1.0, `@turnspike-qie/client` 0.1.1, `@turnspike-qie/cli` 0.1.1 |
| Demo video | (owner uploads; link here) |

## One-line summary (under 140 characters)
Autonomous agents pay for APIs per request in QUSDC on QIE, while their owners keep spending limits the contract enforces.

## Short description (about 100 words)
Turnspike lets an AI agent pay for an API call by itself, in QUSDC on QIE Mainnet, without being able to spend more than its owner allows. The owner deposits a small balance into a settlement contract and posts the rules there: per-call cap, daily cap, allowed merchants, pause and revoke. An API provider adds one Express middleware and names a price; unpaid requests get a signed, expiring HTTP 402 bound to that exact request. The agent's SDK or the `turnspike` CLI checks the quote against its own payee list and price ceiling, pays through the contract, and collects the response. Unaudited; small amounts only.

## Problem
Agents that call paid APIs need a way to pay that does not require a human for each request. Today that usually means handing the agent a key or card that can spend without a hard ceiling. A bug, a prompt injection or a malicious API response can then drain whatever the key can reach. On the other side, an API provider who wants to charge per request has to build payment verification, replay protection and crash recovery before charging the first cent.

## Solution
- **The owner sets the limits on chain.** `TurnpikeAllowance` holds the owner's QUSDC and checks, inside the payment transaction, that the caller is the owner's authorised agent, the merchant is on the owner's allowlist, the amount is within the per-call and daily caps, payments are not paused, and the request id has not been paid before. A compromised agent, SDK or seller cannot get past those checks.
- **The seller quotes a price per request.** `@turnspike-qie/middleware` answers unpaid requests with HTTP 402 and a challenge signed with the seller's HMAC key, expiring, and bound to the method, path and sorted query (optionally body and caller). It verifies the payment receipt on QIE, stores the response before sending it, and replays it if the agent retries, so a crash after payment does not lose what was paid for.
- **The agent pays only what it was told to trust.** `@turnspike-qie/client` refuses any 402 whose origin or merchant is not on the agent's payee list, whose price is above its ceiling, or that the owner's on-chain policy would reject, before broadcasting. Its journal makes a purchase safe to resume after a crash. The `turnspike` CLI exposes the same flow for operators and scripts.
- **Anyone can check a payment** at https://turnspike-qie.vercel.app/operations without a wallet: the on-chain `Paid` event and the gateway's delivery record are read separately and compared (once PR #8 is deployed).
- **The owner manages it in a web console** at https://turnspike-qie.vercel.app/app: deposit, caps, allowlist, pause, revoke and withdraw.

## Target users
1. Developers and operators running AI agents that must buy data or compute from APIs on their own, within a budget someone else controls.
2. API providers who want to charge per request in a stablecoin without building payment plumbing.

## Why AI + Autonomous Agents
The defining property is that the agent acts alone and the human's control does not depend on the agent behaving. The agent signs and pays; the owner's limits are enforced by the contract regardless of what the agent, its SDK or the seller does.

## Innovation claim (what is new is the combination)
Turnspike combines, behind one protocol (`turnspike/1`): contract-enforced owner spending limits; signed, resource-bound HTTP 402 challenges; recoverable paid delivery (stored responses, fenced delivery lease, chain reconciliation, a restart-safe agent journal); and a seller middleware, agent SDK, CLI and web console. None of these ingredients is claimed as invented here. Turnspike is not x402-compatible, is not the first agent-payment system, and has not been externally audited. Comparisons with other projects, with facts, inferences and unknowns labelled, are in `docs/DIFFERENTIATION.md`.

## QIE integration
- Settlement contract deployed and source-verified on QIE Mainnet (chain 1990).
- All payments are in QUSDC on QIE; gas in QIE.
- The seller middleware verifies receipts and `Paid` events against QIE RPC with failover between `rpc1mainnet.qie.digital` and `rpc2mainnet.qie.digital`, and reconciles `Paid` logs after an outage.
- Explorer links to https://mainnet.qie.digital for every transaction.
- QIE ID: an optional, read-only public-name lookup beside the merchant field in the owner console. Forward and reverse records must agree; the name never replaces or authorises the address. It is in PR #8 and counts only once that commit is deployed (`docs/RELEASE_CANDIDATE.md`).
- Not integrated: QIEDEX and the QIE oracles. The console uses any injected EVM wallet; QIE Wallet itself has not been tested.

## Proof on QIE Mainnet (project-operated wallets)
| What | Transaction | Date |
|---|---|---|
| Agent SDK buys `/v1/block-summary` from the hosted gateway, 0.001 QUSDC, delivered; a second run with the same key replays the stored response with no second payment | `0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7` (block 12015683) | 2026-11-19 |
| Payment above the owner's per-call cap reverts with `CapExceeded` | `0x7b4414737c6ccfb74db7237dba65e8c7741dad6d34b1db167a2c33c1d0c7cff1` | 2026-11-19 |
| Reusing a paid request id on chain reverts with `RequestAlreadyUsed` | `0x4092c6a833b48c65a263d27bd06f9753e1efab856ece5cee24ea300fa6de79cb` | 2026-11-19 |
| Owner revokes the agent; the agent's next payment is refused (`NotOwnerAgent`) | revoke `0xe860b21074f65d0880ae9586324498bcea846340a28775457a4d6adfc7e02201` | 2026-11-19 |
Sources: `evidence/M8_sdk_mainnet.md`, `evidence/M7_live_demo.json`, `evidence/M4_mainnet_demo.json`. All transactions used project-operated owner, agent and merchant wallets.

## Measured, not estimated
| Measure | Value | Source |
|---|---|---|
| Gas for one payment | 92,159 gas, 0.000104 QIE at 1.125 gwei | `turnspike api verify` on the transaction above |
| End-to-end paid call on mainnet (quote, pay, 2 confirmations, redeem) | 15 s | `evidence/M8_sdk_mainnet.md` |
| Price of a demo call | 0.001 QUSDC | live gateway 402 |
| Contract tests | 15 passing (including a fuzz test and an ABI check for absent admin functions) | `npx hardhat test` |
| Middleware, gateway, SDK, journal, CLI and web unit tests | 121 passing, local chain with a labelled mock token | `npx vitest run`, `docs/RELEASE_QA.md` |
| Browser tests of the production build | see `docs/RELEASE_QA.md` for the count and commit | `node apps/web-e2e/run.mjs` |
| Static analysis | Slither: no High or Medium findings | `evidence/M6_static_analysis.txt` |
| Gateway deliveries | 5, all project-operated, 0 external | `GET https://turnspike-qie.fly.dev/v1/stats`, 2026-11-24 08:52 UTC |
| External users or merchants | none | not claimed |

## Risks and limitations
- **Deployed bytecode is a coverage-instrumented build (found 2026-11-19).** The bytecode at `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` is 9,610 bytes; a clean optimised compile of `contracts/TurnpikeAllowance.sol` is 3,570 bytes, and the source verified on the explorer contains solidity-coverage probes (functions such as `c_480caa1b` and "modifier-pre/post" markers). The verified deployed source contains coverage instrumentation, and behavioural equivalence of the deployed runtime to the clean build has not been fully established. The 15 contract tests, the Slither analysis and the test gas figures ran against the clean build, so they do not directly validate the exact deployed bytecode. The real mainnet transactions in `evidence/` demonstrate specific behaviours of the deployed contract: an allowed payment, rejections with CapExceeded and RequestAlreadyUsed, and an owner revoke followed by a refused agent payment. Likely cause: the deploy reused artifacts left by `hardhat coverage`. Whether to redeploy a clean build is an owner decision (D2); nothing was redeployed. A reproducibility check of the deployed runtime (exact match from the verified source, identical ABI, 15 contract tests and 18 local-fork checks passing on the deployed build, +4.5 percent gas) is in `evidence/M9_deployed_bytecode_verification.md`; it is not an audit.
- Paid-but-undelivered requests are not refunded automatically, and a restored gateway backup does not know challenges issued after it was taken.
- Unaudited. The contract caps deposits at 5 QUSDC per account; use small amounts.
- The QUSDC issuer can mint and burn by role; Turnspike cannot change that.
- The daily cap uses fixed UTC days, so up to twice the cap can pass across midnight.
- The replay key is `(merchant, requestId)`; a cross-owner collision is possible and documented.
- One SQLite file per seller deployment; no horizontal scaling adapter.
- QIE finality is probabilistic; two confirmations is a configured trade-off.
- A payment mined more than 60 seconds after its challenge expired is rejected and is not refunded automatically.
- The SDK's no-double-payment guarantee is per purchase attempt: if a journal record is marked failed by something other than the SDK while a payment is in flight, the same key can be reused and both attempts can charge (documented in the client README).
- The public demo agent key is a hot key, bounded by its balance, the owner's on-chain caps and the demo's quotas.

## Adoption and next steps
Independent adoption has not been demonstrated: no developer or merchant outside the project has run the flow yet. The adoption path is the three npm packages and `docs/DEVELOPER_ONBOARDING.md`. Next steps after judging: an external developer run of the onboarding guide, an independent security review, and a per-owner replay key (needs a new contract). An experimental custom x402 scheme exists on an unmerged branch (closed PR #7); it has had no public-network payment and stock x402 `exact` clients cannot use it, so no x402 support is claimed.

## Team and AI-assistance disclosure
(Owner writes this section. The factual disclosure of AI assistance is in `docs/HUMAN_REVIEW_LOG.md`; the owner's own contributions must be described by the owner from that log.)
