# Scheme: `turnspike-allowance` (x402 v2)

Status: draft, implemented by `@turnspike-qie/x402` 0.1.0 (unreleased) on branch `feature/x402-v2-integration`. This scheme is not registered with or reviewed by the x402 maintainers. Both the resource server and the client must register it.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Summary

`turnspike-allowance` lets an AI agent pay for an HTTP resource from an allowance account that a human owner funded and limited on chain. The money moves only through `TurnpikeAllowance.pay(owner, merchant, requestId, amount)`, sent by the agent the owner authorised. The contract enforces the owner's per-call cap, daily cap, merchant allowlist, pause and revoke on every payment.

The flow is **upfront**: the client pays on chain first, waits for confirmations, and then sends `PAYMENT-SIGNATURE` carrying a proof of that payment. The facilitator never broadcasts a transaction and holds no key. `settle` binds the existing on-chain payment to the request exactly once.

| Property | Value |
|---|---|
| `scheme` | `turnspike-allowance` |
| x402 version | 2 only (v1 payloads are refused) |
| Network family | `eip155:*` (CAIP-2) |
| `extra.assetTransferMethod` | `vault-pay` |
| `extra.paymentFlow` | `upfront` |
| Underlying protocol | `turnspike/1` (`extra.protocol`) |
| Who broadcasts | the client (the owner's authorised agent) |
| Facilitator signers | none (`getSigners` returns `[]`) |

## 2. PaymentRequirements

Carried in `PaymentRequired.accepts[]` (header `PAYMENT-REQUIRED`, base64 JSON) and echoed by the client in `PaymentPayload.accepted`.

| Field | Type | Rule |
|---|---|---|
| `scheme` | string | MUST be `turnspike-allowance`. |
| `network` | string | CAIP-2 `eip155:<chainId>`, e.g. `eip155:1990` (QIE Mainnet), `eip155:31337` (local Hardhat). |
| `amount` | string | Price in the token's base units, positive integer, no leading zero (`^[1-9][0-9]{0,77}$`). |
| `asset` | string | ERC-20 address the vault holds (QUSDC on QIE Mainnet). MUST equal the token configured on the `TurnpikeAllowance` contract named in `extra.contract`. |
| `payTo` | string | Merchant address. The `Paid` log MUST name it. |
| `maxTimeoutSeconds` | integer | 1 to 86 400. Default: the seller's challenge TTL (300). |
| `extra` | object | Strict: no fields other than those below. |

`extra`:

| Field | Kind | Rule |
|---|---|---|
| `protocol` | static | MUST be `turnspike/1`. |
| `contract` | static | `TurnpikeAllowance` address. |
| `resourceId` | static | Seller-derived identifier of the priced resource (1 to 2048 characters). Binds the payment to one resource. |
| `assetTransferMethod` | static | MUST be `vault-pay`. |
| `paymentFlow` | static | MUST be `upfront`. |
| `requestId` | per challenge | `0x` + 64 hex. `keccak256(abi.encode(bytes32 nonce, address merchant, string resourceId, uint256 amount, uint256 chainId, address contract, uint256 expiresAt))`. Used as `requestId` in `pay`. |
| `sig` | per challenge | 64 hex (no `0x`). HMAC-SHA256 under the seller's secret over the challenge fields. Opaque to the client. |
| `expiresAt` | per challenge | Unix seconds. The client MUST NOT start a payment after it (with its safety margin). |
| `paymentDeadline` | per challenge | Unix seconds, `expiresAt + paymentGraceSeconds` (default grace 60). The payment MUST be mined by this time, judged on chain time. |

Per-challenge fields (`requestId`, `sig`, `expiresAt`, `paymentDeadline`) are excluded from the "accepted equals required" match (`dynamicExtraFields` in `@x402/core`); every static field MUST be echoed unchanged. The resource server MUST compare the echoed per-challenge fields with the challenge it stored.

Example:

```json
{
  "scheme": "turnspike-allowance",
  "network": "eip155:1990",
  "amount": "2500",
  "asset": "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  "payTo": "0x<merchant>",
  "maxTimeoutSeconds": 300,
  "extra": {
    "resourceId": "/report",
    "protocol": "turnspike/1",
    "contract": "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c",
    "assetTransferMethod": "vault-pay",
    "paymentFlow": "upfront",
    "requestId": "0x<64 hex>",
    "sig": "<64 hex>",
    "expiresAt": 1795000000,
    "paymentDeadline": 1795000060
  }
}
```

(`resourceId` is derived by the seller from the price rule and the request, for example the path relative to the mount point plus sorted query; clients treat it as opaque.)

The same signed challenge is also returned as the `turnspike/1` JSON body of the 402, so one route serves both protocols.

## 3. PaymentPayload

The `PAYMENT-SIGNATURE` header is base64 JSON:

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/v1/report" },
  "accepted": { "...": "the PaymentRequirements above, unchanged" },
  "payload": { "requestId": "0x<64 hex>", "txHash": "0x<64 hex>", "sig": "<64 hex>" }
}
```

| Field | Rule |
|---|---|
| `x402Version` | MUST be `2`. |
| `resource` | OPTIONAL (`null` is treated as absent). When present, `resource.url` MUST name the resource requested: same path, and same origin when the seller knows its public origin. |
| `accepted` | MUST be the requirement the client paid, with every field present. |
| `payload.requestId` | MUST equal `accepted.extra.requestId`. |
| `payload.sig` | MUST equal `accepted.extra.sig`. |
| `payload.txHash` | Hash of the mined `TurnpikeAllowance.pay` transaction. |
| `extensions` | OPTIONAL; ignored. |

The payload object is strict: unknown fields make it invalid.

## 4. Client algorithm

A conforming client MUST:

1. Send the request without payment headers. On 402, decode `PAYMENT-REQUIRED` and select an `accepts[]` entry with `scheme = turnspike-allowance` on a network it trusts.
2. Check, before any transaction:
   - `resource.url` has the origin the client actually fetched (redirects only within one origin);
   - the origin and `payTo` are on the agent's payee allowlist;
   - `network`, `extra.contract` and `asset` are the trusted chain, contract and token;
   - `amount` is at or below the agent's ceiling and the x402 spend controls;
   - enough time is left before `expiresAt` and the payment can be mined and confirmed before `paymentDeadline`;
   - the on-chain account allows it: agent authorised, not paused, merchant allowlisted, `amount` within the per-call cap and what is left of the daily cap, enough balance.
   A failed check MUST end the call with nothing paid.
3. Record the challenge under a purchase key in a durable journal before broadcasting. The default key is derived from method, normalised URL, body hash, owner and agent (plus an optional caller `intent`).
4. Send `pay(owner, payTo, requestId, amount)` from the agent key, using a nonce reserved in the journal. Wait for the seller's required confirmations.
5. Send the request again with `PAYMENT-SIGNATURE`.
6. If any non-2xx answer or transport error follows a payment, re-present the **same** `PAYMENT-SIGNATURE` with bounded backoff. The client MUST NOT request a new challenge for a purchase key that has a payment. When the outcome cannot be determined, it MUST report it as possibly paid, never as not paid.

`@turnspike-qie/x402` implements this as `TurnspikeAllowanceClient` (scheme hook) inside `createX402Fetch` (safe wrapper). The scheme hook refuses to run without the wrapper's call context.

## 5. Facilitator

The facilitator is part of the merchant: it needs the seller's HMAC secrets and challenge store. The default is in-process (`LocalFacilitatorClient`). A standalone facilitator (`createFacilitatorServer`) requires HMAC-SHA256 request authentication over timestamp, nonce, method, path and body.

### 5.1 Requirement checks (verify and settle)

In order, the first failure wins:

1. `x402Version` is 2, else `invalid_x402_version`.
2. `scheme` of both the requirements and `accepted` is `turnspike-allowance`, else `invalid_scheme`.
3. Both networks equal the configured network, else `invalid_network`.
4. Requirements parse, else `invalid_payment_requirements`; payload parses, else `invalid_payload`.
5. `asset` is the configured token in both, else `..._asset_mismatch`.
6. `payTo` is the configured merchant in both, else `..._recipient_mismatch`.
7. `accepted.amount` equals the required amount, else `..._amount_mismatch`.
8. `extra.contract` is the configured contract in both, else `..._contract_mismatch`.
9. `maxTimeoutSeconds` equal, else `invalid_payment_requirements`.
10. Every static `extra` field echoed unchanged, else `..._extra_mismatch`.
11. `payload.requestId` and `payload.sig` equal `accepted.extra.requestId` and `.sig`, else `..._proof_mismatch`.

### 5.2 Proof binding

Then the proof checks of `turnspike/1` run (the middleware's `checkProof` / `settleProof`):

- the challenge row for `requestId` exists, its fields hash to `requestId`, and `sig` verifies under a current or previous secret;
- the row's `resourceId` is the one being requested; its merchant, contract and chain are the current ones (or a listed previous merchant);
- the transaction is mined, succeeded, on the configured chain, calls the configured contract, and emits a `Paid` log with this merchant, `requestId` and an amount at least the price;
- it has the required confirmations and is in the canonical chain;
- it was mined by `paymentDeadline` (chain time);
- the transaction hash has not been used for another challenge.

### 5.3 verify

Read-only: runs 5.1 and 5.2 and writes nothing. Returns `{ isValid, invalidReason?, invalidMessage?, payer }`. In the `upfront` flow the resource server does not call it.

### 5.4 settle

Runs 5.1 and 5.2 and commits the challenge row to paid, exactly once. It MUST NOT broadcast. It is idempotent: presenting the same proof again settles to the same transaction. After a successful settle the resource server runs the handler once (under a lease) and stores the response; later presentations of the same proof replay the stored response until `replayWindowSeconds` (if set) expires, after which the answer is 410.

The committed row MUST match the requirements (amount, merchant, issued `expiresAt` and `paymentDeadline`); otherwise settle fails. The `extra` mismatch check therefore runs twice: in the seller before settle (the echoed `expiresAt`/`paymentDeadline` against the issued challenge, 402 `invalid_turnspike_allowance_extra_mismatch`, nothing committed) and in the facilitator after commit (against the committed row).

### 5.5 Settlement response

Header `PAYMENT-RESPONSE`, base64 JSON:

| Field | Success | Failure |
|---|---|---|
| `success` | `true` | `false` |
| `transaction` | the EXISTING `pay` transaction hash | `""`, except `settlement_pending`, which carries the pending hash |
| `network` | the requirement's network | same |
| `payer` | the owner whose account paid (read from the `Paid` log) | the owner when it can be read from the transaction, else `""` |
| `errorReason` | absent | a code from section 6 |
| `errorMessage` | absent | optional detail (`rpc_unavailable`, `storage_unavailable`, pending reason) |

Example (hashes and addresses truncated with `…` for readability; real values are full length): `{"success":true,"transaction":"0xc76a…0a1c","network":"eip155:31337","payer":"0xf39F…2266"}`.

`transaction` refers to a transfer that happened before `PAYMENT-SIGNATURE` was sent. `payer` is the owner, not the agent that signed the transaction.

### 5.6 HTTP status mapping (resource server)

| Situation | Status |
|---|---|
| Settled, handler ran or stored response replayed | 2xx (handler status) with `PAYMENT-RESPONSE` |
| Proof refused | 402 with `PAYMENT-RESPONSE` (`success: false`) |
| `settlement_pending` | 402; client re-presents the same proof |
| RPC or storage unavailable during settle | 503 with `retry-after`; client re-presents |
| Proof after the replay window | 410 |
| Both `X-PAYMENT` and `PAYMENT-SIGNATURE` | 400 `ambiguous_payment_headers` |
| x402 v1-shaped payload | 400 `unsupported_x402_version` |
| Not base64 JSON, too long | 400 `invalid_payment_signature` |
| `x402Version` is not 2 (and not v1-shaped) | 400 `invalid_x402_version` |
| v2 payload for this scheme that fails the payload schema | 400 `invalid_payload` |
| Payload for another scheme | 400 `invalid_scheme` |
| Echoed `expiresAt`/`paymentDeadline` differ from the issued challenge | 402 `..._extra_mismatch` |
| `resource.url` names another resource | 402 `..._wrong_resource` |

## 6. Error codes

Standard x402 v2 codes are used where they exist. Scheme codes are prefixed `invalid_turnspike_allowance_` (written `..._` below). They are not registered with x402; clients match on the exact string.

| Code | Meaning |
|---|---|
| `invalid_x402_version` | `x402Version` is not 2. |
| `invalid_scheme` | Scheme is not `turnspike-allowance`, or not registered on this facilitator. |
| `invalid_network` | Network is not the configured one, or the two networks differ. |
| `invalid_payload` | The PaymentPayload does not match the schema of section 3. |
| `invalid_payment_requirements` | The requirements do not match section 2, or `maxTimeoutSeconds` differs. |
| `settlement_pending` | The payment is known but not yet final (unmined, too few confirmations). Not terminal: re-present the same proof. |
| `unexpected_settle_error` | Settle could not complete. With `errorMessage` `rpc_unavailable` or `storage_unavailable` it is transient (HTTP 503); re-present the same proof. |
| `unexpected_verify_error` | Verify could not complete. |
| `..._asset_mismatch` | `asset` is not the configured token, or `accepted.asset` differs. |
| `..._recipient_mismatch` | `payTo` is not the configured merchant, or the committed row's merchant differs. |
| `..._amount_mismatch` | `accepted.amount` differs from the required amount, or from the committed row's price. |
| `..._contract_mismatch` | `extra.contract` is not the configured contract. |
| `..._extra_mismatch` | A static `extra` field was altered, or echoed `expiresAt`/`paymentDeadline` differ from the issued challenge. |
| `..._proof_mismatch` | `payload.requestId`/`sig` are not those of `accepted.extra`. |
| `..._malformed_proof` | The proof fields are malformed. |
| `..._unknown_request` | No challenge with this `requestId` was issued (or it was purged). |
| `..._integrity` | The stored challenge fields do not hash to `requestId`. |
| `..._signature` | `sig` does not verify under any configured secret. |
| `..._wrong_resource` | The challenge was issued for another resource, or `resource.url` names another resource. |
| `..._wrong_merchant` | The challenge row was issued under another merchant, contract or chain than the current configuration (see `previousMerchants`). |
| `..._different_tx` | The challenge is already settled with a different transaction. |
| `..._tx_reused` | The transaction already settled another challenge. |
| `..._rejected` | The challenge was previously rejected. |
| `..._paid_too_late` | The payment was mined after `paymentDeadline`. The money moved; the seller records it as paid late and does not deliver. |
| `..._wrong_chain` | The transaction is not on the configured chain. |
| `..._tx_failed` | The transaction reverted or was not found. |
| `..._amount_below_price` | The `Paid` amount is below the price. |
| `..._owner_not_permitted` | The paying owner is not in the seller's `allowedOwners`. |
| `..._agent_not_permitted` | The sending agent is not in the seller's `allowedAgents`. |
| `..._no_matching_paid_log` | The transaction has no `Paid` log for this merchant, `requestId` and contract. |

A proof refusal code not listed here is mapped to `invalid_turnspike_allowance_<code>`.

## 7. Security considerations

- **Owner control is on chain.** Caps, allowlist, pause and revoke are enforced by `TurnpikeAllowance.pay`. A refused payment reverts and moves nothing. A client SHOULD read the account first, so most refusals cost no gas.
- **The proof is a bearer token.** Anyone holding a `PAYMENT-SIGNATURE` can obtain the response it paid for (once delivered, a replay). Treat it like a credential, keep it out of logs (the middleware's events are redacted), and set `replayWindowSeconds` (86 400 recommended) so it expires. It can never unlock another resource, merchant, network, token or amount.
- **Payment happens before delivery.** A seller that is down, slow or dishonest after the payment is mined keeps the money without delivering. The client recovers by re-presenting the proof; there is no on-chain refund. A payment mined after the deadline is recorded as paid late (`mw.paidUndelivered()`) for an off-protocol refund.
- **No double charge.** The contract refuses a second `pay` for the same `(merchant, requestId)`. The client's purchase key and journal prevent a second challenge after a payment; settle is idempotent.
- **Payee binding.** The client checks the payee against the URL it fetched, follows redirects only within one origin, and requires `resource.url` to have that origin.
- **Facilitator trust.** The facilitator holds the seller's HMAC secrets. Run it in-process, or authenticate it (HMAC, timestamp, nonce, size limits, bound to 127.0.0.1 by default; `RemoteFacilitatorClient` aborts a request after 30 s by default, `timeoutMs`). It is never a third party.
- **Challenge minting.** Every unpaid request creates a row. Public sellers SHOULD enable `guard` (per-client token bucket, unpaid-row cap, reaper).
- **Resource URL (O4, fail-closed).** With x402 enabled in production (any `NODE_ENV` other than `development` or `test`, including unset, or `x402.production: true`) the seller MUST be configured with a server-trusted public origin (`x402.publicOrigin`, optional `x402.basePath`) or a resolver that does not read `Host` / `X-Forwarded-*`; the middleware, `x402Seller` and `TurnspikeAllowanceServer` throw at construction otherwise, and on a malformed, ambiguous or unsafe value (non-http(s); http outside localhost; userinfo, query, fragment, path, wildcard, several origins, empty host). The canonical URL of a request is `publicOrigin + basePath + path and query of req.originalUrl`, normalised by one function (lowercase scheme and host, default port removed, punycode). It is what `PAYMENT-REQUIRED.resource.url` advertises. A non-canonical request target on a priced route is refused (`400 invalid_request`, `non_canonical_url`).
- **Binding.** A `PAYMENT-SIGNATURE` MUST be refused (`invalid_turnspike_allowance_wrong_resource`) when `accepted.extra.resourceId` differs from the resourceId of the current request, or when `resource.url` is present and differs from the canonical URL of the current request after normalisation. `resource` may be absent; the HMAC-signed `resourceId` then binds the proof. A proof never unlocks another resource.
- **Host and X-Forwarded-* are never trusted.** Express `trust proxy` does not make the request origin trusted. Outside production, with no origin configured, the seller runs a development fallback (one loud warning; `resource.url` advertised from what the server sees; a presented `resource.url` compared by path and query only).
- **Reorgs and finality.** Settle requires the configured confirmations and checks the canonical block.
- **Contract assurance.** `TurnpikeAllowance` has not been audited. The bytecode deployed on QIE Mainnet is a coverage-instrumented build of the tested source (see `docs/OWNER_DECISIONS.md` D2 and `evidence/M9_deployed_bytecode_verification.md`).

## 8. Compatibility: x402 v2 via a registered custom scheme; unmodified `exact` clients cannot pay; not universal/plug-and-play

- This scheme uses the x402 v2 message formats and headers (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`) and the official `@x402/core`, `@x402/express` and `@x402/fetch` libraries (2.31.0). It is x402 v2 compatible **only** for parties that register `turnspike-allowance`.
- An unmodified x402 client that supports only `exact` (EIP-3009 `transferWithAuthorization` or Permit2) finds no `accepts[]` entry it can use and pays nothing. A seller using this package does not offer `exact`.
- A public or third-party facilitator does not know this scheme. No public facilitator supports QIE Mainnet (`eip155:1990`) for it. Settlement runs in the seller's own facilitator.
- x402 v1 payloads are refused.
- It is not a universal or plug-and-play x402 integration. Any x402 wallet, agent framework or marketplace must add this scheme on the client side before it can pay a Turnspike seller.
- The reason is the design: `exact` moves money with a signed authorisation that the facilitator broadcasts, so the owner's on-chain caps and allowlist would not apply. `turnspike-allowance` keeps every payment inside the owner's vault. See `docs/x402/UNIVERSAL_INTEROP.md` for the analysis.
