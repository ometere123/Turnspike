# Turnspike product completeness — build and release contract

Status: release candidate on branch `feat/product-operations-and-identity` (PR #8). Not a claim of production readiness: unaudited, centralised gateway, no external users.

## Product, not staged demo

Turnspike is an agent-to-API payments and spending-controls platform built on QIE. Three audiences: API sellers, agent developers, and account owners. Its own operating model is contract-enforced QUSDC limits, signed HTTP 402 challenges, durable API delivery, and a wallet console. It is not an AI CFO, invoice platform, universal x402 payment gateway, or copy of any competitor.

## Completion criteria

| Journey | Product acceptance |
|---|---|
| Seller | Seller can mount paid Express route, inspect 402 challenge, obtain settlement verification, recover with original proof, and operate persistent storage. |
| Agent developer | Built SDK and CLI provide policy-controlled payment, idempotent retries, journal resume and useful failure reasons. Local Hardhat run demonstrates 402, payment, 200, replay and refusals. |
| Owner | Real wallet can read funded balance and caps, set agent, allow merchants, pause, revoke, withdraw and inspect on-chain history. Each write uses an explicit review step. |
| Operator | A wallet-free Operations Center checks service health, inspects an on-chain Paid event and correlates gateway delivery status without conflating settlement with delivery. |
| Judge | Real historical explorer receipts, local negative controls, working app routes, documented security limits, and clear proof provenance. Nothing simulated is labelled live settlement. |

## Features in this branch

1. A public, read-only Operations Center that queries QIE receipts, checks exact settlement contract and chain, shows owner, agent, merchant, amount and request ID, and separately checks the gateway request record. 
2. An opt-in QIE ID name check beside merchant allowlist controls. It requires matching reverse and forward records and leaves the full payment address unchanged. Names never authorize payments or prove merchant identity.
3. Regression tests for lookup success, address mismatch, multiple names, rate limiting, and invalid input.
4. Navigation and accuracy updates; corrected clean-checkout package build instructions.
5. Explicit documentation of what the mainnet runtime and off-chain delivery do and do not prove.

## State of the work
Implemented and tested in this release candidate; results, commands and limits are in `RELEASE_QA.md`, the task board in `RELEASE_CANDIDATE_TASKS.md`, and the release path in `RELEASE_CANDIDATE.md`.

Deferred by the owner, **not release blockers**: an external developer trial, and expansion of the seller-facing experience.

Only the owner can do: genuine code review and the contribution log, trying a real wallet, choosing the track, approving the production release, approving and uploading the video, giving the team presentation, and submitting the form (`submission/OWNER_TASKS.md`).

## Release constraints

Mainnet vault 0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c stays unchanged. No real payments, key handling, production writes, deployments or npm releases happen as part of this branch. Experimental x402 PR #7 is not included and was closed unmerged; see `X402_DECISION.md`. The existing Toll Plaza visual design is retained and refined. Read-only QIE ID names are not KYC.

Submission criteria and official requirements: https://hackathon.qie.digital/terms
Full hackathon process guide: https://github.com/udaysharmadev/Hackathon-Starter-Pack-Complete-Guide-Roadmap
