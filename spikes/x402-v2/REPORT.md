# Turnspike x x402 v2: interoperability feasibility spike

**Status: spike, not a release.** Nothing here is published, deployed or merged. Turnspike is **still not x402-compatible in any advertised sense**; do not claim otherwise anywhere until the owner decides (see Recommendation).

Branch `claude/x402-v2-spike-27db83`, folder `spikes/x402-v2/`. Released packages (`packages/*`), contracts, gateway, web app and `docs/` are untouched; the spike imports `packages/middleware/src` and `packages/client/src` unmodified. No mainnet transaction was sent, no key was used; Phase A used only `eth_chainId`, `eth_getCode`, `eth_call` and `eth_getStorageAt` reads.

## 1. Verdict in one paragraph

A custom x402 v2 scheme, `turnspike-allowance`, **works end to end** on a local Hardhat chain with the real `TurnpikeAllowance` contract, the official `@x402/core|express|fetch` 2.31.0 SDK on both sides, and the unmodified `@turnspike-qie/client` policy/journal/payment code (23 of 23 tests pass). It is *x402 v2 custom-scheme compatible*: any party that registers this scheme in the official SDK can pay and be paid. It is **not** *plug-and-play standard `exact` compatible*: a stock x402 client refuses the endpoint (it pays nothing), and QIE cannot offer standard `exact` today (QUSDC has no EIP-3009/EIP-2612, Permit2 and the x402 proxy are not deployed on chain 1990, and Permit2 would bypass the vault's owner policy anyway). **Recommendation: GO for a clearly labelled experimental custom-scheme track; NO-GO for any "x402 compatible" claim.**

## 2. Sources actually read (fetched 2026-11-19, not from memory)

| Source | Result |
|---|---|
| `x402-foundation/x402` `specs/x402-specification-v2.md` | Found at the expected path (repo not moved). |
| `specs/transports-v2/http.md` | Found. |
| `specs/schemes/exact/scheme_exact_evm.md` | Found. Lists three transfer methods: EIP-3009, Permit2, **ERC-7710** (the task brief mentioned only the first two). |
| `docs/core-concepts/network-and-token-support.mdx` | Found. |
| `contracts/evm/README.md` | Used for proxy addresses. |
| npm: `@x402/core`, `@x402/evm`, `@x402/fetch`, `@x402/express` | All **2.31.0**, published 2026-11-12 (7 days before this spike; a very fresh pin). Type definitions read from the installed packages. |
| `https://x402.org/facilitator/supported` | Fetched live, saved in `evidence/phaseA_x402org_supported.json`. |

Caveat: the markdown files were read through a summarising fetch tool, not as raw bytes; quotes below are paraphrases of the spec's content, and section references use the spec's **heading names**, not numbers. The SDK behaviour claims were verified against the installed code and by running it.

## 3. The owner's six starting facts

| # | Fact | Verdict | Evidence |
|---|---|---|---|
| 1 | x402 v2 accepts arbitrary `eip155:<id>` | **Confirmed**, with caveats | Network doc: "any EVM chain is allowed at the protocol level" and runtime registration works (`server.register("eip155:*" or id)`). Protocol support is not production support: you need your own facilitator. `$0.01`-style prices need a default asset (needs a PR to the SDK tables); this spike uses explicit `{amount, asset}`. Ran on `eip155:31337`; `eip155:1990` challenges were generated and refused by client policy in test. |
| 2 | Schemes are extensible and an upfront flow exists | **Confirmed** | Spec "extra" section reserves `assetTransferMethod` and `paymentFlow` (`authorization` default, `upfront`, `escrow`). For `upfront`: settle then resource then respond, `/verify` is not used, `extra.paymentFlow` MUST be present, clients MUST NOT build a payment for a flow they do not recognise. Core SDK exposes `SchemeNetworkServer.paymentFlows` and runs settle before the handler for `upfront` (verified in test). |
| 3 | `/settle` can commit an already prepaid proof without broadcasting | **Confirmed for a custom scheme** | The spec describes `/settle` as durably committing payment state and `transaction` as "hash, or empty string if none broadcast". Nothing requires the facilitator to broadcast, and the SDK does not check. Our `settle()` verifies the existing Paid transaction and returns **that** hash; the test asserts exactly one Paid event and that `PAYMENT-RESPONSE.transaction` equals it. This is a property of our scheme's semantics, not something standard `exact` offers. |
| 4 | The vault needs the authorised agent itself to call `pay` | **Confirmed** | `TurnpikeAllowance.pay` reverts `NotOwnerAgent` unless `msg.sender == account.agent`. Bytecode on mainnet has `pay(address,address,bytes32,uint256)` and **no** `payFor`, `owner()` or upgrade selector. The vault has no ERC-1271 `isValidSignature`, so it cannot sign for anything. |
| 5 | QUSDC has no EIP-3009 and no EIP-2612 | **Confirmed** | Mainnet bytecode (6096 bytes, no EIP-1967 proxy) lacks `transferWithAuthorization` (both variants), `receiveWithAuthorization`, `authorizationState`, `permit`, `nonces`, `DOMAIN_SEPARATOR`, `eip712Domain`, `version`. Live `eth_call`s to those revert. It has `mint(address,uint256)` (a privileged function, owner/minter unknown from selectors alone), `totalSupply` 9,171,131,234 base units at audit time. |
| 6 | Standard `exact` Permit2 is a fallback, but would not enforce vault policy | **Confirmed**, with a bigger blocker | Spec: Permit2 "works for any ERC-20", needs a one-time `approve(Permit2)` by the payer (native gas, because QUSDC has no EIP-2612). Permit2 pulls tokens from the **payer's wallet** on the payer's signature; QUSDC held in the vault is not in that wallet, and the vault's caps, allowlist, pause and revoke are never consulted. Separately, **Permit2 and the x402 proxy do not exist on QIE** (below). |

## 4. Phase A: read-only mainnet audit

Command: `npm run audit` (raw output: `evidence/phaseA_mainnet_audit.json`). Both `rpc1mainnet` and `rpc2mainnet.qie.digital` returned chain id 1990 (block 12027366 at audit).

| Address | What | Code on chain 1990 |
|---|---|---|
| `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` | TurnpikeAllowance | 9610 bytes; `token()` = QUSDC; `depositCap` 5,000,000 base units |
| `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | QUSDC | 6096 bytes, plain ERC-20 + `mint` |
| `0x000000000022D473030F116dDEE9F6B43aC78BA3` | canonical Permit2 | **none** |
| `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` | x402ExactPermit2Proxy | **none** |
| `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002` | x402UptoPermit2Proxy | **none** |
| `0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003` | x402BatchSettlement | **none** |
| `0x4020806089470a89826cB9fB1f4059150b550004`, `0x4020425FAf3B746C082C2f942b4E5159887B0005` | ERC3009 / Permit2 deposit collectors | **none** |
| `0x4e59b44847b379578588920cA78FbF26c0B4956C` | CREATE2 deployer (Arachnid) | **none** |
| `0xcA11bde05977b3631167028862bE2a173976CA11` | Multicall3 | **none** |

Facilitators: the default `x402.org` facilitator's `/supported` lists only testnets (`eip155:84532`, Solana devnet, Algorand, Aptos, Stellar, Hedera, XRPL testnets) and contains no `eip155:1990`. I did not probe other third-party facilitators (some need accounts or keys). **Support for a chain is never inferred from EVM compatibility; none was found for QIE.**

Comparison:

| Approach | Works on QIE now | Extra on-chain infrastructure | Preserves vault owner policy | Usable by stock third-party x402 clients |
|---|---|---|---|---|
| Standard `exact`, EIP-3009 | **No**: QUSDC has no `transferWithAuthorization`. | Would need a different token. | n/a (funds are in a wallet, not the vault) | Yes, if it could exist |
| Standard `exact`, Permit2 | **No**: Permit2, the proxy and even the CREATE2 deployer are absent. | Deploy Permit2 at its canonical address, the x402 proxy at its CREATE2 address, and run a facilitator that supports `eip155:1990`; payer must also send an `approve` with native gas. | **No**: Permit2 settlement is independent of the vault. | Yes, once deployed and facilitated |
| Custom `turnspike-allowance` (this spike) | **Yes, locally; mainnet not exercised** (the deployed vault is used as is, no new contract) | None. Needs a merchant-operated facilitator service. | **Yes**: the agent's own `pay` is the only way money moves; caps, allowlist, pause, revoke are enforced by the vault, plus replay key `(merchant, requestId)`. | **No**: the client must register the scheme (and use our call-context wrapper) |

## 5. Phases B and C: what was built and proved

Layout (all in `spikes/x402-v2/`, pinned exact versions in `package.json`/lockfile):

| File | Role |
|---|---|
| `src/server-scheme.ts` | `SchemeNetworkServer` for `turnspike-allowance`: `paymentFlows: {vault-pay: upfront}`, `dynamicExtraFields`, mints a Turnspike challenge (HMAC `requestId`/`sig`, expiry) into `extra` **only on the unpaid request**, always sets `extra.resourceId`. |
| `src/facilitator-scheme.ts` | `SchemeNetworkFacilitator`. `settle()` re-verifies the on-chain Paid log with `packages/middleware` `verifyPayment` (merchant, amount, confirmations, reorg guard, deadline on chain time), binds proof to resource, request, merchant, price, chain, and commits `PAID_CONFIRMED` in the middleware SQLite store; idempotent for the same proof; returns the existing tx hash. No signer, no gas. |
| `src/facilitator-server.ts` | Spec facilitator HTTP API: `GET /supported`, `POST /verify`, `POST /settle`; with a crash-after-commit fault hook for tests. |
| `src/resource-server.ts` | Official `@x402/express` `paymentMiddleware` + `x402ResourceServer` + `HTTPFacilitatorClient`; durable once-only delivery with the middleware store's fenced lease and byte-exact replay. |
| `src/client-scheme.ts` | `SchemeNetworkClient` registered into the official `x402Client`. Hands the requirement to the **unmodified** `TurnspikeClient` (payee allowlist, chain/contract/token trust, price ceilings, expiry margin, on-chain policy/balance/gas pre-checks, approve hook, journal, nonce-pinned pay, crash recovery) as a turnspike/1 challenge through an injected `fetch`; the proof it would have redeemed becomes the `PAYMENT-SIGNATURE` payload. |
| `test/x402.test.ts` | 23 tests (Phase C). |

Wire format produced (see `evidence/phaseC_results.json` for full captured objects):

* `402` with `PAYMENT-REQUIRED` (base64): `x402Version: 2`, `resource`, `accepts[0] = {scheme: "turnspike-allowance", network: "eip155:31337", amount: "1000", asset: <token>, payTo: <merchant>, maxTimeoutSeconds: 300, extra: {assetTransferMethod: "vault-pay", paymentFlow: "upfront", protocol: "turnspike/1", contract, resourceId, requestId, sig, expiresAt, paymentDeadline}}`.
* Retry with `PAYMENT-SIGNATURE`: `{x402Version: 2, resource, accepted, payload: {requestId, txHash, sig}}`.
* `200` with `PAYMENT-RESPONSE`: `{success: true, payer: <owner>, transaction: <the vault Paid tx>, network}`.
* Mainnet shape is the same with `network: "eip155:1990"`; not exercised on chain.

### Test results (`evidence/phaseC_test_output.txt`, 23 passed, about 15 s)

| Scenario | Result | Evidence |
|---|---|---|
| Success and delivery | 200; owner balance down exactly 1000; exactly 1 genuine `Paid(owner, agent, merchant, requestId, 1000)` event; `PAYMENT-RESPONSE.transaction` equals the Paid tx; `payer` equals the owner; handler ran once | `evidence/phaseC_results.json` `success` (tx, block, requestId) |
| Wrong network (`eip155:1990` offered to a client trusting 31337) | refused `wrong_network`, nothing paid | test |
| Wrong token | refused `wrong_network` (token mismatch), nothing paid | test |
| Wrong merchant | refused `untrusted_destination`; and `merchant_not_allowed` when the owner has not allowlisted it on-chain | test |
| Price ceiling | refused `price_above_max` | test |
| Paused account / revoked agent / unlisted merchant | refused `paused` / `not_authorized_agent` / `merchant_not_allowed`, no tx, no charge | test |
| Expiry | challenge with 5 s ttl refused `challenge_expired` | test |
| Invalid proof | forged sig `invalid_turnspike_allowance_signature`; another real Paid tx `invalid_turnspike_allowance_different_tx`; garbage `invalid_payload`; malformed header; all 402, handler not run, no charge | `invalidProofStatuses` |
| Cross-resource replay | proof for `/report?a=1` presented to `/report?a=2` and `/other`: 402 "No matching payment requirements" from the core SDK; facilitator called directly with the wrong resource: `invalid_turnspike_allowance_wrong_resource`; original resource still 200 | `crossResource*` |
| Duplicate requests | same proof twice: both 200, identical stored body, `x-turnspike-replay: 1`, handler ran once, one Paid event | test |
| Concurrent presentation of one proof (8x) | all 200/202, handler not re-run, no new payment | test |
| 5 concurrent purchases | 5 distinct requestIds, 5 Paid events, balance down exactly 5000 | test |
| 2 concurrent calls, one purchase key | exactly 1 payment | `sameKeyConcurrent` |
| Facilitator crash after commit (response lost) | first request 402 (resource server cannot learn the outcome), payment happened once; re-presenting the **same** proof returns 200 with the same tx; still exactly 1 Paid event | `facilitatorCrashAfterCommit` |
| Proof presented while the pay tx is unmined | 402 `PAYMENT-RESPONSE {success:false, errorReason:"settlement_pending", transaction:<hash>}` (non-terminal, matches the spec's `settlement_pending` rule); after mining, the same proof returns 200; a different tx can never be bound afterwards | `settlementPending` |
| Client timeout after broadcast | first call fails `tx_timeout` (maybePaid); after mining, a call with the same purchase key recovers the earlier payment from the journal: 200, still exactly 1 Paid event, even though the server issued a fresh challenge | `clientTimeoutRecovery` |
| Stock `@x402/evm` `ExactEvmScheme` client (unmodified, registered for `eip155:*`) | **Does not pay.** Throws "No network/scheme registered for x402 version: 2 which comply with the payment requirements"; no Paid event, balance unchanged | `stockExactClient` |
| Negative control: standard `exact` advertised for a token lacking EIP-3009 | The stock client's default spend controls refuse a non-default asset before signing; the token has no `transferWithAuthorization` selector | `negativeControl` |

Not tested: real QIE mainnet; real finality/latency; reorgs (the verify code has a guard reused from the middleware, not re-tested here); facilitator HTTP auth; rate limiting; the `escrow` flow; browser CORS; code is type-stripped by vitest and was not separately run through `tsc`.

## 6. Conformance matrix (spec headings; scheme-level, SDK 2.31.0)

| Spec element | Status | Note |
|---|---|---|
| `PaymentRequired`: `x402Version` 2, `resource`, `accepts`, `error` | Conforms | Produced by the SDK. |
| `PaymentRequirements`: `scheme`, `network` CAIP-2, `amount` string, `asset`, `payTo`, `maxTimeoutSeconds`, `extra` | Conforms | `asset` is a token address; `payTo` is the merchant. |
| Network CAIP-2 `eip155:<id>` | Conforms | |
| `extra.assetTransferMethod`, `extra.paymentFlow` | Conforms | `vault-pay` is our own ATM label (values are per-mechanism); `paymentFlow: "upfront"` present as required. |
| Upfront flow: settle before resource, `/verify` not used | Conforms | Verified: handler never ran when settle failed. |
| `PaymentPayload`: `x402Version`, `resource`, `accepted`, `payload` | Conforms | `payload` is our scheme-specific proof, as the spec allows. |
| `accepted` matches a server requirement | Conforms, with `dynamicExtraFields` | Per-402 values (`requestId`, `sig`, expiry) are excluded from the match; `resourceId` is **not** dynamic, which is what makes cross-resource replay fail at the SDK layer. |
| Facilitator `GET /supported`, `POST /verify`, `POST /settle` bodies | Conforms | `signers` empty (no facilitator key exists). |
| `SettlementResponse`: `success`, `transaction`, `network`, `payer`, `errorReason` | Conforms | `settlement_pending` carries a non-empty `transaction`. |
| Error codes | **Partial** | Standard codes used where they exist (`invalid_scheme`, `invalid_network`, `invalid_payload`, `invalid_x402_version`, `settlement_pending`, `unexpected_settle_error`); scheme-specific ones are named `invalid_turnspike_allowance_*`, which the spec does not register. Clients must match on code, so unknown codes need to be documented by us. |
| HTTP transport: 402/200/400/500, `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` base64 | Conforms | Produced by the SDK; failed settle returned 402 with `PAYMENT-RESPONSE`. |
| `exact` scheme semantics | **Not implemented, by design** | The official `exact` is neither redefined nor faked. |
| CORS headers for browser clients | Not tested | |

## 7. Compatible versus plug-and-play, stated precisely

* **x402 v2 custom-scheme compatible (achieved locally):** a server and a client built on the official x402 v2 SDK interoperate over standard HTTP headers and a standard facilitator API, provided **both** register `turnspike-allowance`, the client holds an authorised agent key with an owner policy, and the merchant runs (or trusts) a facilitator that implements this scheme. The 402 is self-describing and an unaware client refuses it safely.
* **Plug-and-play standard `exact` compatible (not achieved, not currently achievable on QIE):** an arbitrary unmodified x402 client or hosted facilitator pays a Turnspike endpoint. Needs a token with EIP-3009, or Permit2 plus proxy deployed and a facilitator for `eip155:1990`, and then the vault's owner policy would not apply.

## 8. Findings that change the design (all observed, not assumed)

1. **The facilitator is merchant-operated, not shareable.** The challenge is an HMAC with a merchant secret and a merchant-side database; a third-party facilitator cannot verify it. A shared facilitator would need public-key challenge signatures (merchant signs, facilitator verifies against a registered merchant key) and its own replay store.
2. **The client scheme cannot see the real request URL.** `createPaymentPayload` receives only the requirement; the payee-origin allowlist therefore relies on a per-call context (`AsyncLocalStorage`) set by our fetch wrapper. Registering the scheme in a stock `wrapFetchWithPayment` without that wrapper fails closed (`no_call_context`). `PaymentRequired.resource.url` is server-controlled and must not be trusted for the allowlist.
3. **x402 clients have no "purchase key".** The default journal key is the challenge's `requestId`, so a caller that simply re-requests after an uncertain outcome gets a fresh challenge and **pays again**. Recovery works only when the caller passes a stable purchase key (shown in test). A stock x402 integration will not do that. This is the largest safety gap versus Turnspike's own client.
4. **The released client pins the agent's pending nonce per payment**, so concurrent payments from one key collide ("nonce too high / could not coalesce" failures were hit during this spike). The spike serialises payments per agent address in-process; the real fix belongs in the client (needs an owner decision; no released code was changed).
5. **`x402Client` default spend controls refuse non-default assets**; QUSDC must be listed in `spendControls.allowedAssets` (the cap there is a useful second ceiling).
6. **402 mints a database row per unpaid request.** Needs rate limiting and retention (the existing middleware has both; this spike's server does not mount them).
7. **`/verify` is meaningless for upfront**; implemented read-only anyway.
8. **Spec gaps:** the core spec calls the `PAYMENT-SIGNATURE` format "not formally defined" while the HTTP transport defines it. The `exact` EVM spec now also includes ERC-7710.

## 9. Obstacles before any mainnet use

1. Run the same suite against QIE Mainnet with a tiny, owner-approved real payment (not done; forbidden for this spike).
2. Measure QIE confirmation latency/finality against `maxTimeoutSeconds` and the facilitator's `confirmations`.
3. Replace HMAC with public-key challenges if third-party facilitators are wanted; define key registration.
4. Fix purchase-key semantics so a default x402 integration cannot double-pay after uncertainty (derive a key from method, URL, body and an intent id by default; or reject re-payment of the same resource within a window).
5. Fix or document the per-agent nonce serialisation in the released client.
6. Rate limiting, retention, observability and structured events for the facilitator and resource server.
7. Registering the scheme name and the `vault-pay` ATM with the x402 maintainers (optional but needed for discoverability); document the `invalid_turnspike_allowance_*` error codes.
8. Independent review of the facilitator and the dynamic-extra matching logic (a new trust boundary).
9. Decide the public wording; today every doc must keep saying Turnspike is not standard-`exact` compatible.

## 10. Recommendation

* **GO** to continue as an *experimental, opt-in custom x402 v2 scheme*, because it is feasible, reuses the deployed vault unchanged and preserves owner policy, and the failure modes tested here (refusals, replay, crashes, concurrency) behave safely at the vault and facilitator layers.
* **NO-GO** on advertising "x402 compatible", on any plug-and-play claim, and on mainnet use until items 3, 4, 5 and 1 of section 9 are done.
* **Standard `exact` on QIE is blocked by chain infrastructure and token design, not by this repo**; it would also defeat the vault's purpose.

## 11. Reproduce

```powershell
# from the repo root (needs Node 22, network access); contracts must be compiled once for the artifacts
npm install --no-package-lock
npx hardhat compile

cd spikes/x402-v2
npm ci
npm run audit      # Phase A, read-only mainnet audit (prints JSON; saved copy in evidence/)
npm test           # Phase C, spawns `npx hardhat node --port 8651` itself, 23 tests
```

Pinned: `@x402/core|evm|fetch|express` 2.31.0, `viem` 2.58.1 (same as `@x402/evm` resolves), `ethers` 6.17.0, `express` 4.22.3, `better-sqlite3` 13.2.0, `vitest` 2.1.9. Evidence files: `evidence/phaseA_mainnet_audit.json`, `evidence/phaseA_x402org_supported.json`, `evidence/phaseC_results.json`, `evidence/phaseC_test_output.txt`. Local test transactions are on an ephemeral Hardhat chain; hashes inside the evidence files are valid only for that run.
