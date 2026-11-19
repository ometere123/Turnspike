# Turnspike protocol `turnspike/1`

A custom HTTP 402 flow settled on QIE. It is **not** x402-compatible (see `INTEROPERABILITY.md`).

## 1. Challenge
An unpaid request to a priced resource gets `402` with:
```json
{ "error": "payment_required", "protocol": "turnspike/1",
  "requestId": "0x…32 bytes", "sig": "64 hex", "priceBase": "1000",
  "token": "0x3F43…5DA5", "contract": "0xA2f2…5d9c", "merchant": "0xceeF…B761", "chainId": 1990,
  "resourceId": "block-summary", "expiresAt": 1795079974, "paymentDeadline": 1795080034 }
```
- `requestId = keccak256(abi.encode(bytes32 nonce, address merchant, string resourceId, uint256 priceBase, uint256 chainId, address contract, uint256 expiresAt))`. The nonce is random and kept by the seller.
- `sig = HMAC-SHA256(secret, requestId|nonce|merchant|resourceId|priceBase|chainId|contract|expiresAt)`. It is the secret half of the proof. Several secrets may verify (rotation).
- `priceBase` is in token base units (QUSDC has 6 decimals).
- `protocol` and `paymentDeadline` were added in this version; clients must accept their absence from older sellers.
- Challenges carry `cache-control: no-store`.

## 2. Resource binding
`resourceId` is what the payment buys. By default it is the request path, prefixed with the method for non-GET requests and followed by the sorted query string (`/a?a=1&b=2`). A seller may fix it (`"block-summary"`), add `#body=sha256(json)` or `#id=sha256(callerId)`. A proof is accepted only on a request that produces the same `resourceId` (otherwise `403 wrong_resource`). Sellers validate input before issuing a challenge (`400 invalid_request`), so an invalid request is never payable.

## 3. Payment
The agent calls `pay(owner, merchant, requestId, priceBase)` on the allowance contract. The contract checks, in order: paused, caller is the owner's agent, merchant allowlisted, non-zero amount, per-call cap, daily cap (UTC day), `(merchant, requestId)` unused, balance; then records the id and transfers QUSDC to the merchant, emitting `Paid(owner, agent, merchant, requestId, amount)`. The payment must be **mined** by `paymentDeadline` (`expiresAt + grace`, chain time).

## 4. Proof and redemption
The agent repeats the request with `X-Payment: base64(JSON {requestId, txHash, sig})`. All three fields are required; extra fields are refused. The seller checks, before revealing anything: proof shape, known request, requestId integrity, sig, resource match, transaction match; then on chain: a `Paid` log from the configured contract for this requestId, merchant, amount at least the price, optional payer allowlists, confirmations, the receipt's block still canonical, and the block time not past the deadline.

| Answer | Meaning |
|---|---|
| 200 | the paid response (stored replay carries `x-turnspike-replay: 1`) |
| 202 `{status:"pending", why, retryAfter}` | `no_receipt`, `confirmations`, `reorg` or `delivering` |
| 402 `{reason}` | proof refused; terminal only for `paid_too_late` |
| 403 / 409 | wrong resource / request bound to another transaction |

## 5. Delivery and replay
The seller stores the response (byte-exact, allowlisted headers) before sending it. Presenting the same proof again returns the stored copy, never a new handler run. Handlers are at-least-once; the response is stored once.

## 6. Recovery
- Seller: `reconcile()` scans `Paid` logs for its merchant and attaches payments for which no proof arrived. Unpaid challenges are purged only after the deadline, a reconcile past it, and the retention period.
- Agent: the client journals nonce, head block and transaction hash around the broadcast, and on restart resolves the state from the chain (`isUsed`, `Paid` logs, nonces) instead of paying again.

## 7. Trust assumptions
- The payer trusts the contract code (verified source, no admin), the QUSDC token, and the seller to deliver after payment; payment is not escrow and cannot be reversed by the protocol.
- The seller trusts its RPC providers for receipts and logs (two providers with failover; finality is probabilistic and only measured, see `evidence/M6_finality_observation.md`).
- The agent trusts its own configuration: payee allowlist, network constants and price ceiling. It never trusts addresses supplied by a 402.
