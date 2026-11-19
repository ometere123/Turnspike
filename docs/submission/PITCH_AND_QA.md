# Pitch deck outline and judge Q&A (drafts for the owner)

## Deck outline (8 slides)
1. **Title:** Turnspike, per-request API payments with owner-enforced limits, QIE Mainnet. Unaudited.
2. **Problem:** agents spend with no hard ceiling; sellers rebuild payment plumbing.
3. **Solution:** the toll gate: 402, pay on chain within owner limits, verify, store, deliver.
4. **How it works:** the sequence diagram from `docs/submission/README.md`.
5. **What is built:** contract (15 tests), middleware, gateway, SDK, CLI, console; 74 plus 15 tests; published 0.1.0.
6. **Proof:** the real mainnet purchase and replay (`evidence/M8`), over-cap and revoke transactions.
7. **Differentiation and honesty:** the combination claim; not x402-compatible; no external users; what we do not claim.
8. **Next:** external developer onboarding, x402 adapter, per-owner replay key, audit.

## Judge Q&A
**Architecture. Why enforce limits in the contract?** A compromised agent, SDK or seller cannot spend past the owner's rules, because `pay()` checks them inside the transaction. The cost is that changing rules needs the owner's transaction, and the contract cannot be upgraded (no admin).

**Why a custom protocol instead of x402?** x402 does not define payer budgets and had no QIE scheme we could find. Our challenge is bound to the request and our delivery is recoverable. We are not x402-compatible; an adapter would need a contract change (see `docs/INTEROPERABILITY.md`).

**Competition?** x402 implementations, agent-wallet platforms, and SpendGrid from QIE Hackathon 2. We could not verify SpendGrid's source, so we make no claim about its internals. See `docs/DIFFERENTIATION.md` for labelled facts, inferences and unknowns.

**Security?** Contract: no admin, single-use request ids, reentrancy test, fuzz test, Slither with no High or Medium findings, but **no external audit**. Seller: HMAC-signed expiring challenges, the `sig` is the secret half of the proof, receipt verified against contract, merchant, request id, amount and canonical block. Agent: payee allowlist, price ceiling, on-chain pre-checks. Residual risks: QUSDC issuer can mint and burn; deposit cap 5 QUSDC; hot demo key bounded by its balance; bearer-proof model (do not put per-customer private data behind a route without identity binding).

**Impact?** Today: one real project-operated purchase flow and a live demo. External users: none. The adoption path is three npm packages and a documented onboarding that no outside developer has yet completed.

**Gas costs?** One payment used 92,159 gas, 0.000104 QIE at 1.125 gwei (`evidence/M8`). Reverted calls on QIE were charged half their gas limit in 5 of 5 samples (hypothesis, `evidence/M6_gas_and_qusdc.md`). A paid call is 0.001 QUSDC plus gas.

**What if the seller crashes after payment?** The response is stored before it is sent; the same proof retrieves it. Payments made while the seller was down are found by `reconcile()`. Handlers run at least once, so they must be idempotent.

**What if a payment is late?** It must be mined within 60 s of the challenge expiry (chain time). A later payment is rejected and is not auto-refunded; there is no refund mechanism.

**Limitations?** Unaudited; fixed UTC-day cap can pass 2x across midnight; centralised seller gateway; single SQLite file; no streaming responses; QIE finality and reorg behaviour only lightly observed; no QIE Wallet, QIE ID, QIEDEX or oracle integration; one chain, one token.

**Was this AI generated?** AI assistance wrote much of the first version (disclosed in `docs/HUMAN_REVIEW_LOG.md`). The owner's contribution must be stated by the owner in their own words from the log; do not claim reviews that have not happened.
