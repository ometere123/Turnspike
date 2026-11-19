# @turnspike/middleware

Express middleware that charges per request in QUSDC on QIE through the Turnspike allowance contract (deployed as `TurnpikeAllowance`). Not published to npm yet: build it from this repository (`npm install && npm run build`) and depend on it with `"@turnspike/middleware": "file:../../packages/middleware"`. A complete example is in `examples/express-api`, and a two-sided run is in `examples/end-to-end`.

```ts
const paid = turnspike({
  rpcUrls: ["https://rpc1mainnet.qie.digital", "https://rpc2mainnet.qie.digital"], chainId: 1990,
  contract: "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c", token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  merchant: process.env.MERCHANT_ADDRESS!, hmacSecrets: [process.env.HMAC_SECRET!], dbPath: "./turnspike.sqlite",
  prices: {
    "/quote": 1000,                                    // 0.001 QUSDC
    "/report/:id": { priceBase: 5000, validate: (req) => (/^\d+$/.test(req.params.id ?? req.path.split("/")[2]) ? null : "bad_id") },
  },
});
app.use("/v1", paid);
setInterval(() => paid.reconcile().then(() => paid.purge()), 15 * 60_000); // recover outage payments, then clean up
```

## Guarantees and limits
- **Proof model.** A paid response is a capability held by whoever presents `{ requestId, txHash, sig }`. The `sig` is delivered only in the 402 response and is required on every redemption, including replays. Treat it like a session token. Turnspike proves a resource was paid for; it does not authenticate the caller. For per-customer data, authenticate callers yourself and bind the identity with `binding.identity`.
- **Resource binding.** By default a payment is bound to the method (non-GET), path and sorted query string. Set `binding.body` to include a hash of the parsed JSON body, `binding.identity` to include an authenticated caller id. A fixed `resourceId` ignores the query unless `binding.query` is true.
- **Validation before price.** `validate(req)` runs before any challenge is issued and before any proof is redeemed. Invalid input gets `400 invalid_request`, so nobody can pay for a request you would reject. `preflight(req)` checks dependencies and answers 503 with no charge.
- **Time.** The payment must be **mined** by `expiresAt + paymentGraceSeconds` (default 60 s, chain time) so a quoted price cannot be paid a day later. A payment mined in time can be **redeemed** later with no deadline while the record is retained.
- **Retention and reconciliation.** Rows with a transaction are never deleted. `reconcile()` scans the contract's `Paid` logs for your merchant and attaches payments that reached the chain while your server was down. `purge()` deletes an unpaid challenge only after its deadline has passed, a reconcile has covered that time, and `retentionSeconds` (default 30 days) has elapsed.
- **Delivery.** The response is stored byte-exact (binary safe) with an allowlist of headers (`cache-control`, `content-type`, `content-disposition`, `content-language`, `content-encoding`, `etag`, `last-modified`, `vary`) before any byte is sent. Cookies are never stored. Handlers run **at least once**: the delivery lease (`deliveryLeaseSeconds`, default 30, minimum 2) is renewed while the handler runs and fenced by a token, so a stale handler can never store or send a competing response, but a crash means the handler runs again. Make handlers idempotent.
- **No streaming.** Responses are buffered up to `maxResponseBytes` (default 1 MiB). Larger responses return 500 and the payment stays redeemable.
- **Multi-process.** Several processes may share one SQLite file (WAL, busy timeout, transactional transitions). Use one file per merchant deployment, on a persistent volume.
- **Contract replay key.** On chain the key is `(merchant, requestId)`. Request ids are random per challenge, but someone who sees a pending request id could pay it first and force the payer to ask for a new challenge (no theft of the resource). Changing this needs a new contract and is not planned.

## Options
Required: `rpcUrls, chainId, contract, token, merchant, hmacSecrets, dbPath, prices`.
Optional: `confirmations` (2), `challengeTtlSeconds` (300), `paymentGraceSeconds` (60; `lateGraceSeconds` is the deprecated name), `retentionSeconds` (2,592,000), `deliveryLeaseSeconds` (30), `maxResponseBytes` (1,048,576), `rateLimitPerMinute` (60), `retryAfterSeconds` (4), `allowedOwners`, `allowedAgents`, `store`, `onEvent`, `clock`.

## Responses
| Status | Meaning |
|---|---|
| 200 | delivered (header `x-turnspike-replay: 1` on a stored replay) |
| 202 | pending: `why` is `no_receipt`, `confirmations`, `reorg` or `delivering`; retry after `retryAfter` seconds |
| 400 | `invalid_request` from your `validate` |
| 402 | a challenge (no proof), or a refused proof with `reason` (`malformed_proof`, `bad_signature`, `unknown_request`, `wrong_merchant`, `amount_below_price`, `no_matching_paid_log`, `paid_too_late`, ...) |
| 403 | `wrong_resource`: the proof is for another resource |
| 409 | `already_redeemed`: the request is bound to a different transaction |
| 429 | `rate_limited` |
| 503 | `rpc_unavailable`, `storage_unavailable` or your `preflight` reason |

Every priced response carries `x-correlation-id` (taken from the request header if present). Structured events (`challenge_issued`, `delivery_started`, `delivered`, `delivery_failed`, `delivery_superseded`, `payment_rejected`, `reconciled`) go to `onEvent` or stdout; they never include proofs, sigs or bodies. Set `TURNSPIKE_LOG=off` to silence the default logger.

The `turnpike` export and `TurnpikeConfig` type remain as deprecated aliases of `turnspike` and `TurnspikeConfig`.
