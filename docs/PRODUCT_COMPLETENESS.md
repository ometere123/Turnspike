# Turnspike product completeness — build and release contract

Status: Active implementation on branch feat/product-operations-and-identity. This is an engineering plan, not a claim of release or production readiness.

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

## Work remaining before calling the whole project complete

- Pass the entire existing GitHub CI: Hardhat contract suite, Vitest, built package end-to-end example, TypeScript, lint, Next.js production build, package audits and secret checks.
- Test the browser on desktop and mobile: missing and reverted transaction, unrelated transaction, valid Paid event, gateway unavailable, request not found, status mismatch, address without QIE name, name mismatch, 429, and wrong-network wallet. No fake numbers.
- Review onboarding with released npm packages, persist real seller data, document platform-specific native module setup and troubleshooting.
- Review gateway operations, quotas, single-instance SQLite limits, backups, incident recovery and process restart using existing runbooks.
- Update judge video only after validating feature behavior and exact timestamps. Record historical transactions as historical, local mock as local, and simulation as simulation.
- Obtain explicit owner release approval for merges, public deployment and any action that spends assets. External developer trial can happen later and is NOT an engineering blocker.
- Record genuine human contribution and decisions in existing owner logs; do not invent independent users or audit status.

## Release constraints

Mainnet vault 0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c stays unchanged. No real payments, key handling, production writes, deployments or npm releases happen as part of this branch. Experimental x402 PR #7 is not included; it offers a custom scheme only and is not plug-and-play stock x402. The existing Toll Plaza visual design is retained and refined. Read-only QIE ID names are not KYC.

Technical results from the 22 November external coding spike reportedly passed 15 Hardhat tests and 99 Vitest tests on local Hardhat with mock ERC-20, plus END-TO-END OK; this feature branch does not claim to have repeated that local test until CI succeeds.

Submission criteria and official requirements: https://hackathon.qie.digital/terms
Full hackathon process guide: https://github.com/udaysharmadev/Hackathon-Starter-Pack-Complete-Guide-Roadmap
