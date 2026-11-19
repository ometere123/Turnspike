# @turnspike/middleware

Express middleware that charges per request in QUSDC on QIE through the Turnspike allowance contract. Not published to npm yet: build it from this repository (`npm install && npm run build`) and depend on it with `"@turnspike/middleware": "file:../../packages/middleware"`. A complete example is in `examples/express-api`.

```ts
app.use("/v1", turnspike({ rpcUrls, chainId: 1990, contract, token, merchant, hmacSecrets: [secret], dbPath, prices: { "/quote": 1000 } }));
```

## Guarantees and limits
- A paid response is a capability held by whoever presents `{ requestId, txHash, sig }`. The `sig` is delivered only in the 402 response and is required on every redemption, including replays. Treat it like a session token.
- Turnspike proves a resource was paid for. It does not authenticate the caller. If a route returns per-customer private data, authenticate callers yourself before `turnspike()`.
- A payment mined before the challenge expired, or within `lateGraceSeconds` (default 24 h) after it, is honoured even if the proof arrives later, so a gateway outage does not cost the payer their resource.
- The stored response is written durably before it is sent. The handler is at-least-once: after a crash mid-handler it runs again when the delivery lease lapses, so handlers must be idempotent.
- Responses are buffered (default limit 1 MiB). Streaming handlers are not supported.
- The replay key on-chain is `(merchant, requestId)`. Request IDs are random per challenge, so cross-tenant collisions are impractical, but an attacker who sees a pending request ID could consume it and force the payer to request a new challenge.

## Options
`rpcUrls, chainId, contract, token, merchant, hmacSecrets, dbPath, prices` are required. Optional: `confirmations` (2), `challengeTtlSeconds` (300), `lateGraceSeconds` (86400), `deliveryLeaseSeconds` (30), `maxResponseBytes` (1048576), `rateLimitPerMinute` (60), `retryAfterSeconds` (4), `allowedOwners`, `allowedAgents`, `store`.

Responses: 200 delivered, 202 pending (retry after `retryAfter`), 402 challenge or refused proof (`reason`), 403 `wrong_resource`, 409 `already_redeemed`, 429 `rate_limited`, 503 `rpc_unavailable` or `storage_unavailable`.
