# Differentiation (DG-1): DRAFT for the project owner to review and adopt

**Status: draft, revised 2026-11-19.** The hackathon rules (HR-008) and the project docs (02 section 5) require the project owner to author and decide DG-1. This draft was prepared with AI assistance from `docs/research/DG1_RESEARCH_NOTES.md`, from the sources listed at the bottom, and from the code in this repository. It becomes the owner's decision only when the owner checks the sources, edits it, and records PASS or FAIL at the bottom. Nothing below is ticked on the owner's behalf.

## Positioning (candidate, for the owner to accept or rewrite)
> Turnspike lets autonomous agents pay for APIs while their owners keep enforceable control over spending. API providers add payment verification with one middleware, agent developers automate payment with a client SDK and CLI, and owners manage permissions in a web console, all settling through one on-chain allowance contract on QIE.

The claim is the **integrated combination**, not any single ingredient:
1. Owner spending policy enforced by the settlement contract itself (per-call cap, daily cap, merchant allowlist, pause, revoke).
2. Seller-side, request-bound payment verification (signed, expiring challenges bound to method, path, query and optionally body or caller).
3. Durable, recoverable redemption (response stored before it is sent, fenced delivery lease, chain reconciliation for payments made during an outage, restart-safe client journal).
4. Practical interfaces over one protocol: `@turnspike-qie/middleware`, `@turnspike-qie/client`, the `turnspike` CLI and the web console.

Turnspike did **not** invent HTTP 402 payments, agent spending caps, replay prevention or crash recovery. Each is known. See "What Turnspike does not claim".

## Implemented and tested (claims are limited to this table)
| ID | Capability | Evidence |
|---|---|---|
| D1 | Payer limits are enforced by the settlement contract, independently of the agent, the SDK and the seller | `contracts/TurnpikeAllowance.sol`; 15 contract tests; mainnet allowed, over-cap, replay and revoke transactions in `evidence/`; client tests CL-06 and CL-15 |
| D2 | Seller middleware: signed, expiring challenges; proof bound to one resource (method, path, sorted query; optional body and caller identity); invalid input refused before a price is quoted | `packages/middleware`; tests TEST-M04, TEST-BIND-1 and the gateway 400 test; the live gateway returns 400 for an invalid address |
| D3 | Durable delivery: response stored byte-exact before it is sent; lease renewed while the handler runs and fenced by a token; stale holders cannot complete | TEST-SEC-F, TEST-LEASE-1, TEST-LEASE-2, TEST-RESP-1, TEST-M09 (real process crash) |
| D4 | Payment deadline separated from redemption: payment must be mined by expiry + 60 s; an in-time payment can be redeemed later; unpaid rows are purged only after a chain reconciliation past the deadline | TEST-EXP-1, TEST-REC-1, TEST-SEC-J; reconcile ran on mainnet over 50,000 blocks (gateway logs) |
| D5 | Agent SDK refuses untrusted payees, the wrong network, prices above the ceiling, and anything the owner's on-chain policy would reject, before broadcasting; its restart-safe journal never pays twice | `packages/client`; 16 tests (CL-01 to CL-16) on a local chain with the real middleware |
| D6 | CLI over the same SDK: inspect accounts, probe and pay endpoints with confirmation, verify transactions, JSON output, documented exit codes | `packages/cli`; 10 tests; read-only commands run against mainnet |
| D7 | Real two-sided flow on mainnet: the SDK example bought from the hosted gateway; a rerun with the same key replayed without a second payment | `evidence/M8_sdk_mainnet.md` (tx 0x7e41cc…21b7) |
| D8 | No admin, upgrade or rescue function in the contract | ABI check in contract tests (SEC-008); Slither, no High or Medium findings |

## Measured, not asserted
| Measure | Value | Source |
|---|---|---|
| Seller integration | 1 middleware mount plus a price map; the example API is about 40 lines | `examples/express-api/src/server.ts` |
| Agent integration | 1 client object (signer, owner, network, policy) and 1 `fetch` call | `examples/node-agent/src/agent.ts` |
| Gas for one payment on QIE | 92,159 gas, 0.000104 QIE at 1.125 gwei | `turnspike api verify` on the mainnet transaction above |
| Time for one paid call on mainnet | 15 s (quote, pay, 2 confirmations, redeem) | `evidence/M8_sdk_mainnet.md` |
| Recovery cases covered by tests | crash mid-handler, crash between broadcast and journal write, unconfirmed transaction, gateway down after payment, payment never redeemed, reorg, storage failure | test names above |
| External users or merchants | **none yet** | not claimed |

## Comparison matrix (facts, inference and unknowns are labelled)
| | Turnspike | x402 (spec v2 and extensions) | Agent-wallet platforms (e.g. Coinbase Agentic Wallets) | SpendGrid (QIE Hackathon 2) |
|---|---|---|---|---|
| Where payer limits are enforced | Settlement contract (fact, D1) | Not part of the protocol; the spec defines the payment flow, not payer budgets (fact) | Platform offers spending limits; where they are enforced is not stated in the documentation read (unknown) | Described as enforcing policy "before transactions reach the blockchain" (reported); on-chain enforcement **unverified**, no source code found |
| Resource binding | Method, path, sorted query; optional body and caller (fact, D2) | `payment_identifier` extension: servers should bind the id to a request fingerprint that includes resource path and method (fact; optional extension) | n/a | unknown |
| Idempotency and replay | On-chain `(merchant, requestId)` replay key plus stored-response replay (fact) | Optional `payment_identifier`: cached response on repeat, 409 on a different payload (fact); SDKs audited in May 2026 lacked such protection (paper; scope is the implementations examined then) | n/a | unknown |
| Durable delivery and outage recovery | Stored before send, fenced lease, chain reconciliation (fact, D3 and D4) | The paper proposes two-phase settlement as a mitigation (fact: a proposal); current implementations not checked here (unknown) | n/a | unknown |
| Buyer SDK with payee allowlist and price ceiling | Yes (fact, D5) | Client libraries exist; their default trust policy was not reviewed here (unknown) | Platform-level policies (reported) | unknown |
| Settlement chain | QIE Mainnet, QUSDC | Many chains through schemes; no QIE scheme found (inference from the spec listing) | Platform-specific | QIE |
| Standards compatibility | **Not x402-compatible** (fact) | Is the standard | n/a | unknown |

## What Turnspike does not claim
It did not invent agent spending limits, HTTP 402 payments, idempotency keys or crash recovery. It does not claim to be first, cheapest, audited, trustless, production-ready or x402-compatible. It does not claim exactly-once execution of arbitrary handlers: the response is stored once and replayed, and handlers run at least once. It does not claim any competitor lacks a feature unless a source says so. The academic findings describe the implementations examined in May 2026, not every current implementation. It has no external users yet.

## Open items before this can be called PASS
1. Find SpendGrid's source or contract (the QIE Hackathon 2 announcement could not be fetched in this session either), so D1 is compared with a verified fact.
2. Decide whether an x402 adapter is worth building (see `docs/INTEROPERABILITY.md`).
3. Decide whether the combination, rather than any single feature, meets the judges' innovation criterion.
4. Get one independent developer or merchant to run the two-sided flow. Until then, adoption is zero.

## Sources consulted for this revision
- x402 specification folder and extensions, including `payment_identifier.md`: https://github.com/coinbase/x402/tree/main/specs
- "Five Attacks on x402 Agentic Payment Protocol", arXiv 2605.11781 (12 May 2026): https://arxiv.org/html/2605.11781v1
- IETF draft "x402 delegation binding" (May 2026): https://datatracker.ietf.org/doc/html/draft-vauban-x402-delegation-binding-01
- Earlier sources and their labels: `docs/research/DG1_RESEARCH_NOTES.md`

## Recommendation (prepared 2026-11-19; not a decision)
Recommend PASS on the combination claim only, provided the owner has read the sources above and accepts that SpendGrid is unverified and adoption is zero. FAIL is a defensible alternative if the owner judges that the individual ingredients are too well known. See `docs/OWNER_DECISIONS.md` D1. The checkbox below is deliberately left unticked.

## Owner decision
- [ ] PASS   - [ ] FAIL        Decided by: ____________   Date: ____________
Reasoning in the owner's words:
