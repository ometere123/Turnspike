# @turnspike-qie/x402

x402 v2 support for Turnspike through a registered **custom scheme**, `turnspike-allowance`. It is not the standard `exact` scheme. A Turnspike seller can be paid over x402 v2 only by a client that registers this scheme (for example `createX402Fetch` from this package). Unmodified `exact` clients cannot pay.

What it contains:

- **Seller:** `x402Seller(mw)`, an Express handler that serves x402 v2 (`PAYMENT-SIGNATURE`) and `turnspike/1` (`X-PAYMENT`) on the same route, through the official `@x402/express` and `@x402/core` 2.31.0.
- **Facilitator:** `LocalFacilitatorClient` (in-process, the default) and `createFacilitatorServer` / `RemoteFacilitatorClient` (standalone, HMAC-authenticated). The facilitator never broadcasts a transaction and holds no key.
- **Agent:** `createX402Fetch`, a wrapper around the official `@x402/fetch` that pays through the owner's `TurnpikeAllowance` vault with `@turnspike-qie/client`, and that never pays the same purchase twice.
- **Scheme hooks:** `TurnspikeAllowanceServer`, `TurnspikeAllowanceFacilitator`, `TurnspikeAllowanceClient`, plus the schemas and `ErrorCodes`.

The scheme is specified in [`docs/x402/SCHEME.md`](../../docs/x402/SCHEME.md). The design is in [`docs/x402/ARCHITECTURE.md`](../../docs/x402/ARCHITECTURE.md). A 15-minute local walkthrough is in [`docs/x402/GETTING_STARTED.md`](../../docs/x402/GETTING_STARTED.md).

## Install

Not published to npm. Use it from this repository (workspace use):

```bash
git clone <this repository> && cd <repository>
npm install                      # root: Hardhat, contracts
npx hardhat compile
cd packages/x402 && npm install  # @x402/* 2.31.0, ethers, zod, express, tsx
npm test                         # local Hardhat chain only
```

Inside the repository, `@turnspike-qie/middleware` and `@turnspike-qie/client` resolve to the workspace sources (see `tsconfig.json` paths, and `examples/x402-agent/tsconfig.json` for an example project). `@x402/core` is pinned to exactly 2.31.0.

## Seller quick start

```ts
import express from "express";
import { turnspike } from "@turnspike-qie/middleware";
import { x402Seller } from "@turnspike-qie/x402";

const mw = turnspike({ rpcUrls, chainId: 1990, contract, token, merchant, hmacSecrets: [secret], dbPath: "./seller.sqlite",
  prices: { "/report": 2500 }, x402: { publicOrigin: "https://api.example.com" },  // required in production (O4)
  guard: true, replayWindowSeconds: 86_400 });
const app = express();
app.use("/v1", x402Seller(mw));                       // mount where the middleware would be mounted
app.get("/v1/report", (_req, res) => res.json({ ok: true }));  // runs only after settlement
app.listen(8080);
```

## Agent quick start

```ts
import { TurnspikeClient, FileJournal } from "@turnspike-qie/client";
import { createX402Fetch, FileProofStore } from "@turnspike-qie/x402";

const journal = new FileJournal("./agent-journal.json");
const client = new TurnspikeClient({ signer: agentSigner, owner, network, journal, confirmations: 2,
  policy: { payees: [{ origin: "https://api.example.com", merchant }], maxPriceBase: 5_000n } });
const pay = createX402Fetch({ client, journal, owner, agent: await agentSigner.getAddress(),
  network: { chainId: network.chainId, token: network.token }, proofStore: new FileProofStore("./agent-proofs.json") });
const r = await pay("https://api.example.com/v1/report");
if (r.ok) console.log(await r.response.json()); else console.log(r.error, { paid: r.paid, maybePaid: r.maybePaid });
```

`agentSigner` is the agent key the owner authorised on the vault. Never use the owner's key.

## Configuration reference

### Seller (`turnspike(...)` options that matter for x402)

| Option | Default | Guidance |
|---|---|---|
| `x402` | off | Must be `true` or an object; `x402Seller` throws otherwise. Object fields: `publicOrigin`, `basePath`, `resourceUrl`, `production`, `maxTimeoutSeconds` (default `challengeTtlSeconds`, 300), `description`, `mimeType`. |
| `x402.publicOrigin` / `x402.basePath` | none | **Required in production (O4): the middleware throws at construction without it.** Server-trusted public origin and optional proxy prefix; `resource.url` = origin + basePath + path and query. See below. |
| `x402.resourceUrl` | none | Alternative to `publicOrigin`: the same origin string, or a resolver `(req) => url` that must not read `Host` / `X-Forwarded-*` (enforced). |
| `x402.production` | true unless `NODE_ENV` is `development` or `test` (unset = production) | Production mode for the resource URL policy. |
| `guard` | off | Challenge-issuance guard (per-client token bucket, unpaid-row cap per route, reaper, query limits). Recommended for any public x402 endpoint: `guard: true`. Behind a proxy, set `trust proxy` or `clientKey`, or every client shares one bucket. |
| `replayWindowSeconds` | 0 (no expiry) | After this long a delivered response is purged and its proof answers 410. Recommended: `86400`. A leaked `PAYMENT-SIGNATURE` is a bearer token until then. |
| `previousMerchants` | none | Challenges issued under an earlier merchant address are refused (`..._wrong_merchant`) unless the old address is listed here. |
| `confirmations` | 2 | Settlement waits for this many; agents should wait at least as many before presenting. |
| `paymentGraceSeconds` | 60 | `paymentDeadline = expiresAt + grace` (chain time). |
| `allowedOwners`, `allowedAgents` | none | Optional allowlists checked at settlement. **Set them when the content is caller-specific.** A proof is a bearer proof: without payer binding, anyone who obtains a leaked challenge (its `requestId` and `sig`) and pays it at full price from their own vault account is delivered that resource. With `allowedOwners` / `allowedAgents`, such a payment is refused as `owner_not_permitted` / `agent_not_permitted`. See `docs/x402/O6_REQUESTID_GRIEFING.md`. |

**Canonical resource URL (O4, fail-closed).** When `x402` is enabled and the process runs in production (any `NODE_ENV` other than `development` or `test`, including unset, or `x402.production: true`), the middleware **throws at construction**, before any request is served, unless it has a server-trusted public origin:

- `x402.publicOrigin: "https://api.example.com"` (or `x402.resourceUrl` as the same origin string), plus optional `x402.basePath: "/api"` when a reverse proxy strips a public prefix. The canonical URL of a request is `publicOrigin + basePath + path and query of req.originalUrl`.
- or `x402.resourceUrl: (req) => absoluteUrl`, a resolver. It receives a request view on which `Host`, `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `req.protocol`, `req.hostname`, `req.secure` and `req.ip` throw. Its result is normalised and must end with the request's own path and query; otherwise the request fails closed with `500 resource_url_resolver_failed`.

One normalisation function (`normalizeOrigin`, exported) validates the origin: lowercase scheme and host, default port removed, IDN hosts in punycode. It refuses (with `ResourceUrlConfigError`, in every environment): a non-http(s) scheme; http outside `localhost`/`127.0.0.1`/`[::1]`/`*.localhost` in production; userinfo; a query or fragment (even empty); an empty host; wildcards; several origins (comma or whitespace); any path (use `basePath`); a trailing dot. `basePath` must be `/seg[/seg]` with no trailing slash, dot or empty segment, encoded `.`/`/`/`\`, query, fragment or wildcard. Setting both `publicOrigin` and `resourceUrl`, or `basePath` with a resolver, is refused as ambiguous.

The trusted origin never comes from `Host` or `X-Forwarded-*`, and Express `trust proxy` does not change that. A request target that is not in canonical form (dot segments, `//` prefix, backslash, malformed or encoded `.`/`/`/`\` in the path, a non-normalised query encoding) on a priced route is refused with `400 invalid_request`, reason `non_canonical_url`, before a challenge is written.

**Development fallback.** Outside production, with no origin configured, the middleware prints one loud `WARNING [turnspike x402] ... DEVELOPMENT FALLBACK` line per process, advertises `resource.url` from what the server sees, and the x402 seller compares a presented `resource.url` by path and query only (the origin is never trusted, `trust proxy` or not). An invalid configured value is refused in development too: there is no silent fallback for a bad value.

`turnspike/1`-only deployments (no `x402`) are unaffected: no policy is built, nothing is validated, nothing is printed, and responses are unchanged (`scripts/compat/turnspike1-diff.mjs`).

**Binding in `x402Seller` (O4).** A `PAYMENT-SIGNATURE` is refused with `402 invalid_turnspike_allowance_wrong_resource` when `accepted.extra.resourceId` is not the resourceId of the current request, or when it carries a `resource.url` that is not the canonical URL of the current request (exact match after normalisation: origin, base path, path and query; dev fallback: path and query). `resource` may be omitted (a header rebuilt from the journal omits it); the proof stays bound by the signed `resourceId`. `x402Seller(mw, { production })` (default: production unless `NODE_ENV` is `development` or `test`) also throws at construction when the middleware runs the development fallback in production, and `TurnspikeAllowanceServer({ ..., resource })` applies the same policy when used on its own.

`x402Seller(mw, opts)`:

| Option | Default | Meaning |
|---|---|---|
| `facilitator` | `new LocalFacilitatorClient(mw)` | Any `@x402/core` `FacilitatorClient`. Use `RemoteFacilitatorClient` for a standalone facilitator. |
| `description`, `mimeType` | `""` | Copied to `PaymentRequired.resource` on SDK-produced responses. |
| `maxHeaderLength` | 8192 | Longer `PAYMENT-SIGNATURE` headers are refused (400). |

### Facilitator

- **In-process (default).** `LocalFacilitatorClient(mw)`. No network hop; the HMAC secrets never leave the process.
- **Standalone (opt-in), for several seller instances sharing one store.** `createFacilitatorServer({ backend: mw, secrets: [s1, ...previous], host?, port?, maxSkewSeconds?: 60, rateLimitPerMinute?: 600, maxBodyBytes?: 65536, nonceDb?, onEvent? })`. Each secret is at least 32 bytes. Binds to `127.0.0.1` by default. Every request carries an HMAC-SHA256 over timestamp, nonce, method, path and body; nonces are kept in the store's SQLite database (`facilitator_nonces`), so a restart does not reopen replay. On the seller: `x402Seller(mw, { facilitator: new RemoteFacilitatorClient({ url, secret, timeoutMs? }) })`; `timeoutMs` defaults to 30 000 (30 s) per facilitator request. The facilitator is part of the merchant: never expose it publicly, never share its secrets with a third party.

### Agent (`createX402Fetch`)

| Option | Default | Meaning |
|---|---|---|
| `client` | required | `TurnspikeClient` (0.2.0). Its policy applies: payee allowlist, price ceiling, chain/contract/token trust, expiry margin, on-chain account checks. |
| `journal` | required | The same journal given to the client. Use `FileJournal` for restart safety. |
| `owner`, `agent` | required | Part of the default purchase key. |
| `network` | required | `{ chainId, token }`: registered network and the x402 spend-control asset. |
| `maxPriceBase` | none | Extra per-payment ceiling (x402 spend controls). |
| `proofStore` | `MemoryProofStore` | Keeps the accepted requirement and the `PAYMENT-SIGNATURE` per purchase key. Use `FileProofStore` for restart safety. |
| `retry` | 8 attempts, 1 s first delay, 15 s cap, 120 s total | Re-presentation of a paid proof. |
| `maxTimeoutSeconds` | 300 | Used when rebuilding a lost `accepted` from the journal. |
| `maxRedirects` | 3 | Redirects are followed manually and only within one origin. |
| `fetch`, `onEvent` | global fetch, none | Injection and structured events. |

Per call: `pay(url, init?, { intent?, purchaseKey?, maxPriceBase? })`.

- **Purchase key.** By default `keccak(method, normalised URL, body hash, owner, agent, intent)`. Calling again with the same request resumes the same purchase; it never pays twice. To buy the same resource again on purpose, pass a new `intent` (for example a date or job id).
- **Bodies.** String, `URLSearchParams`, `Uint8Array` and `ArrayBuffer` bodies are hashed. Streams, `FormData` and `Blob` need an explicit `purchaseKey` (otherwise `unhashable_body`, nothing paid).
- A key already used for a different method, URL or body returns `idempotency_conflict` and pays nothing.

## Error handling

`pay()` returns `{ ok: true, kind: "free" | "paid", response, purchaseKey, resumed, transaction? }` or `{ ok: false, error, message, paid, maybePaid, purchaseKey, status?, proof? }`. It does not throw for payment outcomes.

| `paid` | `maybePaid` | Meaning | What to do |
|---|---|---|---|
| false | false | Nothing was paid (policy refusal, on-chain refusal, bad challenge). | Fix the cause; a retry is safe. |
| false | true | The outcome is unknown (a transaction may be in flight, or another call holds the key). | Do not treat as unpaid. Call `pay` again with the same request (or key) later, or run `client.recoverPending()`. |
| true | false | Paid on chain, not delivered (yet). | Call `pay` again with the same request: it re-presents the same proof and never pays again. |

Common `error` values:

| Error | paid | Cause and action |
|---|---|---|
| `untrusted_destination` | false | The origin or merchant is not on the agent's payee list. Add it only if you trust it. |
| `wrong_network`, `unsupported_protocol`, `invalid_challenge` | false | The requirement names another chain, contract or token, or is malformed. |
| `price_above_max` | false | Price above the agent's ceiling. |
| `over_per_call_cap`, `over_daily_cap` | false | The owner's on-chain caps. The owner raises them, or wait for the next day. |
| `merchant_not_allowed` | false | The merchant is not on the owner's on-chain allowlist. |
| `not_authorized_agent`, `paused`, `insufficient_balance` | false | Owner action needed (authorise, unpause, deposit). |
| `insufficient_gas`, `gas_cost_above_max`, `declined` | false | Agent gas, gas ceiling, or the `approve` callback said no. |
| `tx_timeout`, `rpc_unavailable`, `request_failed` | check `maybePaid` | A transaction may be in flight. Same request again, or `recoverPending()`. |
| `challenge_expired` | false | Too little time to mine before the deadline. Retry. |
| `payment_not_created` | false | The x402 client found no usable requirement (e.g. not `turnspike-allowance`, spend controls). |
| `cross_origin_redirect`, `too_many_redirects` | false before payment | Redirect left the origin. Check the URL. |
| `idempotency_conflict`, `unhashable_body` | false | See purchase key above. |
| `payment_pending` | false, maybePaid true | Another call holds the key, or the outcome of a sent transaction is not settled yet. Retry later with the same key. |
| `already_paid` | false | The challenge's requestId was used on chain by someone else before the agent sent anything. `pay()` already requested one fresh challenge; this result means the fresh one was consumed too. Retry later. |
| `request_used_by_other_payer` | false | The agent's own transaction was mined and reverted because another payer used the requestId first (front-run). The owner was not charged (gas only). `pay()` already requested one fresh challenge (bounded to one retry); this result means it was front-run again. |
| `redeem_timeout` | true | Paid; the seller did not deliver within the retry budget (down, `settlement_pending`, 503). Call again with the same request. |
| `redeem_rejected` | true | Paid; the seller refused the proof (`status` and message carry the code, see `docs/x402/SCHEME.md` section 6). Investigate; for `paid_too_late` ask the merchant (it is listed in `mw.paidUndelivered()`). |
| `replay_window_expired` | true | Paid and delivered earlier; the stored response was purged (410). |
| `proof_unpresentable` | true | Payment recorded but no matching requirement can be rebuilt. Keep the `proof` and contact the merchant. |

Fresh challenge after a consumed requestId: when the first challenge's requestId was used by another payer (`already_paid` before sending, or `request_used_by_other_payer` after a mined revert), `pay()` requests exactly one fresh challenge in the same call and emits `x402.agent.retry` with reason `fresh_challenge:<code>`. It never does this for `paid` or `maybePaid` outcomes.

On the seller, refusals are logged as `x402.refused` / `x402.settle.fail` with the code; transient RPC or storage failures answer 503 with `retry-after`.

## Recovery

Use a `FileJournal` and a `FileProofStore` (both hold payment proofs: protect them like credentials). After a crash or restart:

```ts
const journal = new FileJournal("./agent-journal.json");
const client = new TurnspikeClient({ ...sameOptions, journal });
const pay = createX402Fetch({ ...sameOptions, client, journal, proofStore: new FileProofStore("./agent-proofs.json") });
for (const r of await client.recoverPending()) console.log(r.key, r.before, "->", r.after, r.note ?? r.result?.ok);
// then repeat the unfinished requests: pay() with the same request (or purchaseKey) re-presents the recorded proof
```

`recoverPending()` settles every unfinished journal record from the chain (confirms broadcast payments, finds payments whose hash was not recorded, closes abandoned reservations) without HTTP. Calling `pay()` again for the same request then presents the recorded `PAYMENT-SIGNATURE`, or rebuilds it from the journal, and never asks for a new challenge.

## Multi-process agents

Several processes may share one agent key, one `FileJournal` and one `FileProofStore` on one machine: nonces are reserved in the journal under compare-and-set, and the proof store serialises writes with a lock file (`<path>.lock`, a stale lock is taken over after 10 s). This is covered by a multi-process test (`test/x402.spec.ts`). Across machines, give each machine its own agent key (the owner can authorise only one agent per account, so use separate owner accounts), or put a single payment process in front.

## Support matrix

| | Supported | Notes |
|---|---|---|
| x402 version | v2 | v1 payloads are refused (400 `unsupported_x402_version`). |
| Scheme | `turnspike-allowance` only | Custom scheme, `assetTransferMethod: vault-pay`, `paymentFlow: upfront`. No `exact`. |
| Networks | QIE Mainnet `eip155:1990` | Through the deployed `TurnpikeAllowance` vault `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c`. |
| | Local Hardhat `eip155:31337` | Tests and examples, with `MockERC20` as a labelled test token. |
| Token | QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` (6 decimals) | Whatever token the vault was deployed with. |
| Facilitator | In-process `LocalFacilitatorClient`; standalone authenticated `createFacilitatorServer` | Both run by the merchant. No public facilitator supports `turnspike-allowance` or `eip155:1990`. |
| Server framework | Express 4 | Through `@x402/express` 2.31.0. |
| Client | `createX402Fetch` (Node 20+) | Stock `@x402/fetch` without this scheme cannot pay. |

## Limitations

- **Custom scheme only.** x402 v2 compatible through a registered custom scheme; not universal and not plug-and-play. Unmodified `exact` clients, wallets and marketplaces cannot pay until they add `turnspike-allowance`. See `docs/x402/UNIVERSAL_INTEROP.md`.
- **Mount binding (R1), x402 only.** `resourceId` is relative to the Express mount (it is part of turnspike/1 and of the requestId, so it is unchanged). Each challenge row stores the mount prefix (`req.baseUrl`) it was issued under, and an x402 presentation (`PAYMENT-SIGNATURE`, through `x402Seller` and `mw.deliver`) is accepted only under that prefix, so one middleware mounted under `/a` and `/b` cannot have a proof for `/a/x` unlock `/b/x`, with or without `resource`. Consequence: an x402 challenge must be paid and presented under the mount it was issued under; a reverse proxy that changes the mount prefix between the 402 and the retry gets `invalid_turnspike_allowance_wrong_resource`. Rows written before this column existed are not mount-checked. **The turnspike/1 `X-PAYMENT` path does not read the stored mount and behaves exactly as on `origin/main`**, including when the instance has `x402` enabled: a challenge issued under `/a` redeems under `/b`, and the reverse, and across a proxy prefix change. This was tested by running the same scenarios against `origin/main`'s middleware and this branch (`packages/middleware/test/mount-legacy.test.ts`, plus the last case of `packages/x402/test/r1-mount-binding.spec.ts`); the 12-step compat diff alone cannot show this because it never mounts one instance under two prefixes.
- **Unaudited contract.** `TurnpikeAllowance` has not had a security audit.
- **Deployed build.** The bytecode on QIE Mainnet is a coverage-instrumented build of the tested source; equivalence to the clean build is supported by the checks in `evidence/M9_deployed_bytecode_verification.md` but not fully established. See `docs/OWNER_DECISIONS.md` D2.
- **Pay before delivery.** If a seller takes the payment and never delivers, there is no on-chain refund; recovery is re-presenting the proof, or asking the merchant.
- **Unpublished.** Version 0.1.0 is not on npm; APIs may change.
- `@x402/core` is pinned to 2.31.0.
