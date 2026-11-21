# x402 v2: review of the feasibility spike, and standard-exact interoperability (Phases 1 and 3)

Date: 2026-11-20. Branch `feature/x402-v2-integration` (main at `01c7f3b` plus the spike commit `bd85bdd`). Five independent read-only reviews: protocol conformance, payment safety, security, architecture, and standard `exact` interoperability. No code changed, no transaction sent.

## 1. What is proven (local Hardhat chain, real TurnpikeAllowance, official @x402/core, express and fetch 2.31.0)
- The conformance reviewer re-ran the spike suite: **23 of 23 tests pass**.
- The official SDK middleware, client, `HTTPFacilitatorClient` and facilitator HTTP API carry a registered custom scheme, `turnspike-allowance`, end to end, using the spec's reserved `paymentFlow: "upfront"` and a custom `assetTransferMethod` (`vault-pay`).
- **Owner policy is preserved.** Payment goes through `TurnpikeAllowance.pay`, so per-call cap, daily cap, merchant allowlist, pause and revoke still apply. Refusals cost nothing.
- **Delivery integrity.**
  - One payment yields one delivery.
  - A forged `sig`, a wrong transaction and a reused transaction are all rejected.
  - Concurrent presentations of one proof run the handler once.
  - If the facilitator commits and then loses its response, re-presenting the same proof delivers without a second payment.
  - `settlement_pending` is returned while the payment is unmined.
  - A client crash after broadcast is recovered from the journal, but only when the caller supplied a stable key.
- An unmodified `ExactEvmScheme` client refuses the endpoint and pays nothing.

## 2. Conformance (spec `x402-specification-v2.md`, fetched 2026-11-20)
- **Conforms:**
  - PaymentRequired fields (§5.1.2): CAIP-2 `eip155:1990`, atomic amount, asset, payTo, maxTimeoutSeconds.
  - `extra` used for scheme data (§6).
  - Reserved `assetTransferMethod` and `paymentFlow` (§6.1); a check runs before the resource executes (§6.1).
  - Payload shape (§5.2.2).
  - `/verify` is read-only in the upfront flow (§7.1).
  - Settle that binds a proof without broadcasting (§7.2).
  - `settlement_pending` (§9).
  - `/supported` (§7.3).
- **Deviates:**
  - `payer` is omitted on verify and settle failures (§5.4.2, §7.1).
  - `transaction` is not always empty on failure (§5.3.2).
- **Extensions:** `extra` fields (`requestId`, `sig`, `contract`, `resourceId`, `expiresAt`, `paymentDeadline`) and `invalid_turnspike_allowance_*` error codes.
- **Missing:** a written scheme specification, handling of `extensions` and `EXTENSION-RESPONSES`, and a check against the HTTP transport document text (the reviewer used the SDK's behaviour).
- **Semantics to state openly:** the money moves on chain inside the client's `createPaymentPayload`, before `PAYMENT-SIGNATURE` is sent. `transaction` in PAYMENT-RESPONSE refers to that earlier transfer.

## 3. Payment-safety gaps (must fix before any release)
| # | Gap | Severity |
|---|---|---|
| S1 | A retry after an uncertain outcome without a caller-supplied key gets a new challenge and **pays again** (default key is the per-challenge requestId). | Critical |
| S2 | Paid, but the server answers 402 (`settlement_pending` or a dropped settle). The stock fetch wrapper returns a plain 402, and a naive retry pays again. | Critical |
| S3 | Crash between broadcast and sending the proof leaves a payment findable only by a requestId the caller never saw. | High |
| S4 | The payee allowlist uses a caller-supplied context URL, not the URL actually fetched; redirects can make them differ. | High |
| S5 | Lost PAYMENT-RESPONSE is not re-presented automatically. | High |
| S6 | Two processes sharing one agent key can collide on nonces (no double charge, but false `maybePaid` and stuck records). | Medium |
| S7 | A payment mined after the deadline is `paid_too_late`; the money moves and nothing is delivered; no refund path. | Medium |

## 4. Security gaps (must fix before any release)
- **High:**
  - **Facilitator exposure:** it is unauthenticated, holds the merchant's HMAC secrets and shares its database. It is part of the merchant, not a third party, and should run in-process.
  - **Allowlist bypass:** the payee allowlist can be bypassed through the context URL (same issue as S4).
  - **Challenge-minting DoS:** every unpaid request inserts a row, with no quota, proof of work or reaper.
- **Medium:**
  - **Bearer proof:** the proof is a bearer token, and a leaked header replays the paid response with no replay window.
  - **Regressions against `packages/middleware`:** the resource server lost the existing 503 mapping, CORS, redacted logging and body binding.
  - **Facilitator inputs:** body validation is incomplete and errors leak.
- **Low:**
  - `verify` writes (`paid_too_late` → REJECTED).
  - `resourceId` is accepted from the caller.
  - Secret handling is minimal.

## 5. Standard `exact` interoperability (Phase 3)
**Conclusion: an unmodified x402 `exact` client cannot pay a Turnspike endpoint on QIE today. No `exact` transfer method can ever route through the TurnpikeAllowance vault policy.** Every `exact` method moves funds from the payer's own wallet or smart account:
- **EIP-3009:** the facilitator calls `token.transferWithAuthorization`.
- **Permit2:** `Permit2.permitWitnessTransferFrom` via the x402 proxy.
- **ERC-7710:** the facilitator itself builds `token.transfer(payTo, amount)` and redeems it through a DelegationManager.

Evidence (read-only RPC to `rpc1mainnet.qie.digital`):
- Chain id is 1990.
- QUSDC bytecode has no `transferWithAuthorization`, `receiveWithAuthorization`, `permit`, `nonces` or `DOMAIN_SEPARATOR`.
- `eth_getCode` returned empty at the canonical Permit2, the x402 exact Permit2 proxy addresses, the ERC-4337 EntryPoint v0.7 and the DelegationManager addresses checked. The MetaMask addresses were recalled from memory and not re-fetched; this needs confirming.
- The spike recorded that the x402.org facilitator lists no `eip155:1990` (not re-checked in this review).

| Mechanism | Works on QIE today | Needs new infrastructure | Keeps vault policy | Stock exact client | Redeploy TurnpikeAllowance |
|---|---|---|---|---|---|
| exact, EIP-3009 | No | a new EIP-3009 token | No | yes, with a different token | No (the vault is bypassed) |
| exact, Permit2 | No | Permit2, the x402 proxy, a facilitator for 1990, and a payer on-chain approve | No | yes, once deployed | No (the vault is bypassed) |
| exact, ERC-7710 | No | DelegationManager, enforcers, smart accounts, a facilitator | Only re-implemented in enforcers, not by the vault | yes, once deployed | No (the vault is bypassed) |
| Custom `turnspike-allowance` (spike) | Yes, locally | none for the basic flow | **Yes** | **No** (needs the scheme plugin) | No |

**Redeployment:** none is required for x402 v2 custom-scheme support. A plug-and-play `exact` rail would not need a TurnpikeAllowance redeploy either, but it would be a separate rail outside the vault policy, needing new third-party contracts (Permit2 and its proxy, or a delegation framework) plus a facilitator that supports chain 1990.

**Optional later enhancement (not exact-compatible):** a small `TurnspikeX402Agent` contract registered as an owner's agent, verifying EIP-712 `PayIntent`s signed by a session key and calling `vault.pay`. It would allow gasless agents while the vault still enforces policy. It needs its own audit, and it is still a custom scheme.

## 6. Terms used from here on
- **x402 v2 compatible (custom scheme):** any client using the official x402 SDK, with the `turnspike-allowance` scheme registered, can pay and be paid over the standard x402 v2 HTTP flow. **Proven locally.**
- **Plug-and-play standard exact compatible:** an unmodified exact client pays without any Turnspike plugin. **Not achievable on QIE today; not achievable through the vault at all.**
The first is not evidence of the second, and no Turnspike material may say otherwise.
