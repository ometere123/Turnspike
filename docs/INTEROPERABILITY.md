# Interoperability: Turnspike and x402

**Turnspike is not x402-compatible and does not claim to be.** This note evaluates an adapter; nothing here is built.

## Differences that matter
| | Turnspike `turnspike/1` | x402 v2 (coinbase/x402 `specs/`) |
|---|---|---|
| Settlement | Agent calls `pay()` on an allowance contract; owner limits enforced on chain | Scheme-defined; the common `exact` scheme has the payer sign a transfer authorization that a facilitator settles |
| Who broadcasts | The agent (pays gas in QIE) | Usually a facilitator |
| Proof | `X-Payment: base64({requestId, txHash, sig})` after settlement | Payment payload in a header before settlement; server verifies and settles via a facilitator |
| Payer budget | Contract state (caps, allowlist, pause, revoke) | Out of scope of the protocol |
| Idempotency | On-chain request id plus stored response | Optional `payment_identifier` extension |

## Adapter options
1. **Seller-side x402 front door.** Accept x402 payment payloads for an `exact`-style scheme and settle them into the merchant address. This bypasses the allowance contract, so the owner's on-chain limits would no longer apply: it would be a different product. Not recommended.
2. **A Turnspike scheme for x402.** Define an x402 scheme (`turnspike-allowance`) whose payment payload is a signed authorization that a facilitator submits through the allowance contract. This keeps on-chain limits, but the contract's `pay()` must be called by the agent address; a facilitator could only submit it if the contract accepted signed authorizations, which the deployed contract does not. Requires a new contract version.
3. **Discovery only.** Publish x402-style discovery metadata (and/or OpenAPI) describing Turnspike endpoints so agent frameworks can find prices, while keeping Turnspike's flow. Cheap, honest, and useful; no compatibility claim.

## Recommendation
Option 3 now (no contract change). Option 2 only if there is demand from x402 clients and an approved contract migration. Any compatibility statement must be backed by conformance tests against the official x402 reference implementation.

## Decision required from the owner
Whether to pursue option 2 (new contract deployment, migration of owners' balances, new audit scope).
