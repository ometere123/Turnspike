# Pitch outline and judge Q&A (drafts for the owner)

Track: **AI + Autonomous Agents** (proposed by the owner; see `FOUNDER_DECISIONS.md`).

## Pitch outline (8 slides or 8 beats)
1. **Title:** Turnspike. Agents pay at the gate; owners set the toll. Per-request API payments in QUSDC on QIE Mainnet. Unaudited.
2. **Problem:** an agent that can pay usually holds a key with no hard ceiling; a seller that wants per-request payment rebuilds verification and recovery.
3. **Solution:** the owner posts limits in a settlement contract; the API answers 402 with a signed quote for one request; the agent pays within the owner's limits; the API verifies, stores and delivers.
4. **How it works:** the sequence diagram in `docs/submission/README.md`.
5. **What is built:** contract on QIE Mainnet; seller middleware; agent SDK and CLI on npm (middleware 0.1.0, client and CLI 0.1.1); web console; 15 contract tests and 99 middleware, gateway, SDK, journal and CLI tests.
6. **Proof:** the real mainnet purchase `0x7e41ccaa…21b7` (0.001 QUSDC, 92,159 gas, 15 s) and its replay with no second charge; the over-cap and replay refusals on chain. All project-operated, dated 19 November 2026.
7. **Honesty:** the claim is the combination; not first, not x402-compatible, not audited; no external users yet.
8. **Next:** an external developer run, an independent review, a per-owner replay key, an x402 adapter.

## Judge Q&A
**Why is this an agent project and not just payments?** The agent decides and pays alone. The owner's control does not depend on the agent behaving: the contract checks the owner's rules inside every payment, so a compromised agent, SDK or seller still cannot exceed them.

**Why enforce limits in the contract?** Because it is the only component every payment must pass through. The cost: changing rules takes an owner transaction, and the contract cannot be upgraded (no admin).

**Why a custom protocol instead of x402?** x402 defines the payment flow, not payer budgets, and we found no QIE scheme. Our challenge is bound to the request and delivery is recoverable. We are not x402-compatible; an adapter would need a contract change (`docs/INTEROPERABILITY.md`).

**Competition?** x402 implementations, agent-wallet platforms, and SpendGrid from QIE Hackathon 2. We could not verify SpendGrid's source, so its internals are marked unknown (`docs/DIFFERENTIATION.md`).

**Is the deployed contract the one you tested?** Not byte for byte: the deployed build includes solidity-coverage instrumentation (9,610 bytes versus 3,570 for the clean build). Same source logic plus no-op probes; tests and Slither ran on the clean build; mainnet behaviour was observed on the deployed contract. See D2.

**Security?** Contract: no admin, single-use request ids, a fuzz test, Slither with no High or Medium findings, **no external audit**. Seller: HMAC-signed expiring challenges; the `sig` is the secret half of the proof; receipts checked against contract, merchant, request id, amount and a canonical block. Agent: payee allowlist, price ceiling, on-chain pre-checks, a revision-fenced journal. Residual risks: the QUSDC issuer can mint and burn; deposits capped at 5 QUSDC; the hot demo key is bounded by its balance and caps.

**What if the agent crashes mid-payment?** The journal records the nonce before broadcasting. On restart the client finds the payment on chain (`isUsed`, the `Paid` log) and collects the response; an unknown outcome is reported as "may have been paid" (`maybePaid`, CLI exit 4), never as "not paid".

**What if the seller crashes after payment?** The response is stored before it is sent and replayed for the same proof; payments made while the seller was down are found by `reconcile()`. Handlers run at least once.

**Can one idempotency key ever pay twice?** Not within one purchase attempt: the key is claimed atomically, and every write is checked against the record's revision. If a record were marked failed by something outside the SDK while a payment was in flight, the key could be reused and both attempts could charge; the README states this.

**Impact today?** One project-operated purchase flow on mainnet, a live demo, three npm packages. External users: none. External developer testing is deferred.

**Gas?** 92,159 gas, 0.000104 QIE per payment at 1.125 gwei. A paid call is 0.001 QUSDC plus gas.

**Late payments?** A payment mined more than 60 s after the challenge expired (chain time) is rejected and not refunded automatically.

**Limitations?** Unaudited; UTC-day cap can pass 2x across midnight; centralised seller gateway; one SQLite file; no streaming responses; QIE finality lightly observed; no QIE Wallet, QIE ID, QIEDEX or oracle integration; one chain, one token.

**Was this AI generated?** AI assistance wrote much of the code, and this is disclosed in `docs/HUMAN_REVIEW_LOG.md`. The owner answers this question personally from the log.
