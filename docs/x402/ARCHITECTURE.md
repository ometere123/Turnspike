# Turnspike x402 v2 integration: architecture and contracts

Status: working design for branch `feature/x402-v2-integration`. Requirements come from `docs/x402/PHASE1_REVIEW.md` (S1–S7 payment safety, H/M security findings). Nothing here changes the deployed `TurnpikeAllowance` contract.

## Principles
1. **Owner control is enforced on chain.** Every Turnspike payment, on either protocol, is `TurnpikeAllowance.pay` by the owner's authorised agent. No code path moves the owner's funds any other way.
2. **One payment, at most one charge per logical purchase**, across retries, crashes, restarts, processes and protocols. Uncertain outcomes are surfaced as `maybePaid`, never silently retried into a second charge.
3. **turnspike/1 keeps working unchanged.** Existing middleware and client tests must pass unmodified.
4. **Honest compatibility.** "x402 v2 compatible via the registered `turnspike-allowance` scheme" is the claim. Unmodified `exact` clients are refused and pay nothing.
5. **Official libraries.** The `@x402/core` types and HTTP encoding are used wherever possible; Turnspike code implements the scheme hooks only.

## Packages
| Package | Change | Version |
|---|---|---|
| `@turnspike-qie/middleware` | Additive: subpath exports `./challenge`, `./verify`, `./store`; issuance guard (quotas, unpaid-row cap, reaper); `deliver()` hook; 402 also carries `PAYMENT-REQUIRED`; CORS expose headers; redacted structured logs; replay window; paid-undelivered listing | 0.2.0 (unreleased) |
| `@turnspike-qie/client` | Additive: public `payChallenge()`; purchase intents; durable per-agent nonce allocation in the journal; `proof_presented` state | 0.2.0 (unreleased) |
| `@turnspike-qie/x402` (new) | Scheme implementations for server, facilitator and client; `x402Seller()` dual-protocol adapter; `createX402Fetch()` safe agent entry point; optional standalone facilitator with authentication | 0.1.0 (unreleased) |
| `@turnspike-qie/cli` | `--protocol x402`, `x402 probe`, `doctor` checks for x402 | 0.2.0 (unreleased) |

`@x402/core` is a peer dependency of `@turnspike-qie/x402` only, pinned to an exact version (2.31.0) until an interoperability suite covers a wider range.

## Seller (resource server)
```ts
import { turnspike } from "@turnspike-qie/middleware";
import { x402Seller } from "@turnspike-qie/x402";
const mw = turnspike(cfg);                    // unchanged turnspike/1 middleware
app.use("/v1", x402Seller(mw, { network: "eip155:1990" }));
```
- **One route, two protocols.** Header negotiation:
  - `X-PAYMENT` → turnspike/1 (unchanged).
  - `PAYMENT-SIGNATURE` → x402 v2.
  - Both → 400.
  - Neither → 402 with the unchanged JSON body plus a `PAYMENT-REQUIRED` header built from the **same** signed challenge row.
  - An x402 v1-shaped payload on `X-PAYMENT` → 400 with a clear error.
- **Facilitator embedded in-process by default** (`LocalFacilitatorClient` implementing the `@x402/core` FacilitatorClient interface). No network hop; the HMAC secret never leaves the merchant. A standalone facilitator (`createFacilitatorServer`) is opt-in for multi-instance sellers. It requires HMAC request authentication with a timestamp and nonce (replay-protected), binds to a configured interface, validates request bodies, and shares the store.
- **Settle in the upfront flow** verifies the already-mined `Paid` event with the existing `verifyPayment` (contract, merchant, requestId, amount, confirmations, canonical block, chain-time deadline) and runs the same store transitions. Delivery goes through the middleware's existing fenced lease and stored response.
- **Cross-protocol rule.** A challenge row is protocol-neutral: a payment for requestId R unlocks R's resource once, whichever header presents the proof. A proof can never unlock a different resource, merchant, network, token or amount. Downgrade is harmless because both protocols enforce identical checks.
- **Abuse limits:**
  - per-client token bucket on challenge issuance;
  - a global cap on unpaid rows per route;
  - an ISSUED-row reaper after expiry plus grace;
  - query-length and parameter-count limits;
  - a replay window after DELIVERED (configurable, default 24 h), after which the stored response is purged and the proof returns 410.
- **Errors.** Storage failure → 503. RPC failure → 503 `rpc_unavailable`. Settlement pending → 402 with `settlement_pending`, the hash and the network. Responses conform to §5.3.2: `transaction` empty and `payer` present on failure.
- **Paid but undelivered.** A payment mined after the deadline is recorded as `PAID_LATE`, never silently dropped, and listed by `mw.paidUndelivered()` and the CLI, so the merchant can honour or refund it off-protocol.

## Agent (client)
```ts
import { TurnspikeClient } from "@turnspike-qie/client";
import { createX402Fetch } from "@turnspike-qie/x402";
const pay = createX402Fetch({ client, journal });  // wraps official @x402 fetch with the registered scheme
const res = await pay("https://api.example.com/v1/report?id=7");
```
- **Single entry point.**
  - **Payee binding:** `createX402Fetch` uses `redirect: "manual"`. It refuses a redirect to another origin, and binds the policy check to the exact URL it fetched. The 402 `resource.url` must match that origin.
  - **Context-free calls:** the scheme refuses when called without the wrapper's context (fail closed).
- **Purchase key (S1).**
  - **Default:** a deterministic key is derived from (method, normalised URL, body hash, owner, agent), plus an optional caller `intent` to allow deliberate repeat purchases.
  - **Unresolved purchase:** while a purchase under that key is unresolved (`paying`, `broadcast`, `confirmed`, `proof_presented`), the wrapper never requests a new challenge. It resumes the recorded purchase and returns `maybePaid` if the outcome is still unknown.
  - **Repeat purchases:** a second purchase of the same resource requires a distinct `intent`.
- **Never re-challenge after paying (S2, S5).** After a payment exists for the key, any non-2xx or transport error leads to re-presenting the same PAYMENT-SIGNATURE with bounded backoff. The journal records `proof_presented`.
- **Startup recovery (S3).** `recoverPending()` resumes every unfinished journal record.
- **Durable nonce coordination (S6).**
  - `Journal.allocateNonce(agent, chainPending)` reserves the next nonce with the same revision compare-and-set as `swap`.
  - With `FileJournal`, this is safe across processes on one machine.
  - Allocation takes the maximum of the chain's pending nonce and the journal's next reservation.
  - Released or failed reservations are reconciled against the chain before reuse.
- **Confirmations.** The client waits for at least the seller's required confirmations before presenting the proof, to reduce `settlement_pending`.

## Deadlines and finality (S7)
- The client refuses quotes with less than `minSecondsToExpiry` remaining (existing behaviour). It also refuses when the expected mining time plus confirmations exceeds the payment deadline margin.
- The seller honours payments mined by `paymentDeadline` (chain time) and records later ones as `PAID_LATE`.
- Finality: the existing 2-confirmation policy and reorg guard (canonical block check) apply to both protocols.

## Observability
Each event is a JSON line:
- `x402.challenge`, `x402.settle.ok`, `x402.settle.pending`, `x402.settle.fail` (with code), `x402.deliver`, `x402.replay`, `x402.refused`;
- the existing turnspike/1 events;
- a `correlationId` on each.

Logs never include `sig`, the PAYMENT-SIGNATURE header, private keys or response bodies.

## Test bar
Everything below runs on a local Hardhat chain with the real `TurnpikeAllowance`, the official `@x402` SDK on both sides, and real HTTP between separate processes where stated:
- interoperability;
- a stock `exact` client refused;
- x402 v1 rejected;
- mismatches (merchant, network, token, contract, amount, expired, tampered extra);
- replay (cross-resource, cross-merchant, cross-protocol, leaked header after the window);
- concurrency (N purchases across 2 processes sharing one agent key and journal);
- crash and restart (client killed after broadcast; seller killed after settle and before delivery);
- uncertain settlement plus a naive retry without a key (exactly one Paid event);
- quotas and reaper;
- facilitator authentication;
- owner controls (caps, allowlist, pause, revoke);
- the full existing regression suites unchanged.
