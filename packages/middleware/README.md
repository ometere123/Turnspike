# @turnspike-qie/middleware

Express middleware that charges per request in QUSDC on QIE through the Turnspike allowance contract (deployed as `TurnpikeAllowance`). Install: `npm install @turnspike-qie/middleware express`. A complete example is in `examples/express-api`, and a two-sided run is in `examples/end-to-end`.

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

0.2.0 additions, all opt-in so that the 0.1.x defaults are unchanged:
- `guard` (off): challenge-issuance guard (per-client token bucket, query length/count limits, cap on live unpaid rows per route, periodic reaper of expired unpaid rows). `true` uses the defaults; an object overrides some of them. Recommended for public deployments, including x402: `guard: { burst: 120, refillPerSecond: 2, maxUnpaidPerRoute: 10000, maxQueryLength: 2048, maxQueryParams: 64, reaperIntervalSeconds: 300 }` (these are the defaults of `guard: true`). The default client key is `req.ip`; behind a proxy set Express `trust proxy` correctly or pass `clientKey`.
- `replayWindowSeconds` (0 = no expiry, as in 0.1.x): after this long a delivered response is purged and its proof answers 410. Recommended for x402 deployments: `86400`.
- `exposeHeaders` (true): adds `Access-Control-Expose-Headers` for the payment headers on priced responses.
- `x402` (off): also emit x402 v2 `PAYMENT-REQUIRED` on challenges (see `@turnspike-qie/x402`). `x402Seller()` does not change any of the defaults above, because it serves turnspike/1 on the same route; set them on the middleware yourself.
- `previousMerchants` (none): see below.

**Merchant changes (`wrong_merchant`).** Every challenge row records the merchant that issued it. A proof is refused with `402 wrong_merchant` when the row's merchant, contract or chain differs from the current configuration, so changing `merchant` (or sharing one database between merchants) refuses every challenge issued under the previous merchant, even one already paid on chain. To honour such challenges after a change, list the old addresses in `previousMerchants`; the on-chain check still requires the `Paid` log to name the row's merchant. `reconcile()` only scans logs for the current merchant.

## Default behaviour changes from 0.1.x (0.2.0, unreleased)
Everything listed in "0.2.0 additions" above is opt-in except the items below, which change what an existing 0.1.x deployment sees without a config change. Details and reasons are in `docs/CHANGELOG.md` ("Unreleased: middleware 0.2.0").
- **`wrong_merchant`.** A proof whose challenge row was issued under another merchant, contract or chain than the current configuration is refused (`402`, reason `wrong_merchant`), even when it was paid on chain. 0.1.x only required the on-chain `Paid` log to name the row's merchant. To keep honouring challenges issued before a merchant change, list the old addresses in `previousMerchants`.
- **`Access-Control-Expose-Headers`** is added on priced responses (`exposeHeaders`, default `true`; existing values are kept, `*` is left alone). Set `exposeHeaders: false` for the 0.1.x behaviour.
- **Redacted events.** `onEvent` (and the stdout logger) now receives a redacted copy of each event: keys that name proofs, sigs, payment headers, bodies or credentials are dropped, nested objects are dropped, bigints become strings, and an exception thrown by `onEvent` is swallowed instead of failing the request. None of the 0.1.x events carried such fields, so their content is unchanged; there is no switch to receive unredacted events (the new x402 events are the reason for the redaction).
- **Storage errors at confirmation.** A SQLite error other than a `UNIQUE` violation while recording a confirmed payment now answers `503 storage_unavailable` (retry later). 0.1.x answered `409 already_redeemed / tx_reused` for any error there, which told a paying client its proof was permanently refused. A `UNIQUE` violation (the transaction already backs another request) is still `409 tx_reused`.
- **Schema migration.** On open, the store adds the nullable columns `route TEXT`, `disposition TEXT`, `deliveredAt INTEGER`, `responsePurgedAt INTEGER` to `payments` and creates the index `payments_route_open ON payments(route, state, expiresAt)`. The migration is additive (no data rewritten); rows written by 0.1.x keep `NULL` in the new columns. A 0.1.x process can still open the migrated file, but back the file up before upgrading.

**Canonical resource URL (O4, fail-closed).** When `x402` is enabled and the process runs in production (`NODE_ENV=production`, or `x402.production: true`), the middleware **throws at construction**, before any request is served, unless it has a server-trusted public origin:

- `x402.publicOrigin: "https://api.example.com"` (or `x402.resourceUrl` as the same origin string), plus optional `x402.basePath: "/api"` when a reverse proxy strips a public prefix. The canonical URL of a request is `publicOrigin + basePath + path and query of req.originalUrl`.
- or `x402.resourceUrl: (req) => absoluteUrl`, a resolver. It receives a request view on which `Host`, `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `req.protocol`, `req.hostname`, `req.secure` and `req.ip` throw. Its result is normalised and must end with the request's own path and query; otherwise the request fails closed with `500 resource_url_resolver_failed`.

One normalisation function (`normalizeOrigin`, exported) validates the origin: lowercase scheme and host, default port removed, IDN hosts in punycode. It refuses (with `ResourceUrlConfigError`, in every environment): a non-http(s) scheme; http outside `localhost`/`127.0.0.1`/`[::1]`/`*.localhost` in production; userinfo; a query or fragment (even empty); an empty host; wildcards; several origins (comma or whitespace); any path (use `basePath`); a trailing dot. `basePath` must be `/seg[/seg]` with no trailing slash, dot or empty segment, encoded `.`/`/`/`\`, query, fragment or wildcard. Setting both `publicOrigin` and `resourceUrl`, or `basePath` with a resolver, is refused as ambiguous.

The trusted origin never comes from `Host` or `X-Forwarded-*`, and Express `trust proxy` does not change that. A request target that is not in canonical form (dot segments, `//` prefix, backslash, malformed or encoded `.`/`/`/`\` in the path, a non-normalised query encoding) on a priced route is refused with `400 invalid_request`, reason `non_canonical_url`, before a challenge is written.

**Development fallback.** Outside production, with no origin configured, the middleware prints one loud `WARNING [turnspike x402] ... DEVELOPMENT FALLBACK` line per process, advertises `resource.url` from what the server sees, and the x402 seller compares a presented `resource.url` by path and query only (the origin is never trusted, `trust proxy` or not). An invalid configured value is refused in development too: there is no silent fallback for a bad value.

`turnspike/1`-only deployments (no `x402`) are unaffected: no policy is built, nothing is validated, nothing is printed, and responses are unchanged (`scripts/compat/turnspike1-diff.mjs`).

Example behind a TLS-terminating proxy that serves the app under `https://api.example.com/shop`:

```ts
turnspike({ ...cfg, x402: { publicOrigin: "https://api.example.com", basePath: "/shop" } });
```

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
