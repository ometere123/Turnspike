# Operations Center: payment settlement and delivery are separate facts

`/operations` is a read-only, wallet-free page. It sends no transaction and runs no demo. Whether it is live in production is recorded in `RELEASE_CANDIDATE.md`.

## What each answer means
| Shown | Means | Colour |
|---|---|---|
| Paid event found | Exactly one `Paid` event from the configured vault, in the block this RPC considers canonical, at least 2 confirmations, RPC head under 3 minutes old | success |
| still settling / RPC is behind | The same, but too few confirmations or an old head | warning |
| Pending / Not found | The RPC knows the transaction but it is unmined / knows nothing about it | warning / neutral |
| Reverted / No Turnspike Paid event | Mined, but not a Turnspike payment | danger / neutral |
| Uncertain | Replaced block, receipt for another hash, more than one `Paid` event, missing status, head behind the block | warning |
| Not verified | Wrong chain, timeout (12 s), rate limit, HTTP or malformed answer: no verdict at all | danger |

A gateway record is compared on **both** identifiers. Only the same request ID and the same transaction, settled, with state `DELIVERED`, is shown as agreement, and it says delivery is the gateway's own claim. A different hash or request ID is an error. Editing either field discards its answer and any read in flight.

## Workflow

1. Paste an actual QIE transaction hash into Verify on-chain payment. The client reads the RPC chain ID, transaction receipt, canonical block hash and Paid events emitted by the configured TurnpikeAllowance address.
2. For a matching Paid event, it displays amount in QUSDC, exact owner/agent/merchant addresses, request ID, block number, confirmations and explorer link. A receipt is not evidence that the API delivered a response.
3. The request ID is prefilled into Inspect gateway delivery. Read the existing public gateway status-only endpoint. DELIVERED means the gateway database reports a persisted response; it is not an on-chain guarantee.
4. Compare transaction hashes. A different or missing gateway hash cannot establish correlation. For interrupted deliveries, keep the original proof and use the SDK journal/resume mechanism; never create a new purchase to retry an ambiguous payment.

## Trust boundaries

- The gateway's status and usage figures are its own database claims. Counts can include project-operated wallets. RPC checks are independent of the gateway but rely on the configured provider.
- A reverted contract call can still consume QIE gas. A 404 gateway record does not prove non-payment.
- The gateway has no automatic refund for paid-but-undelivered requests. Paid resource delivery is an off-chain operation. A handler can execute more than once after failure, so seller handlers must be idempotent.
- Public QIE ID directory names are optional display hints beside the full hexadecimal address. Forward and reverse agreement is not a business-identity verification or permission to pay.
- The existing settlement contract is unaudited. The deployed runtime is coverage-instrumented and differs from the clean optimized artifact. See evidence/M9_deployed_bytecode_verification.md.
- Production deployment, signing, new mainnet transactions and secret changes are explicitly outside the scope of this read-only feature.

## Release QA

Validate valid, missing, reverted, unrelated and noncanonical receipts; gateway states DELIVERED, PAID_PENDING, DELIVERING, REJECTED, missing and unavailable; different transaction hashes; QIE ID record mismatch, multiple names, 404, 429 and network outage. Test keyboard navigation, long hashes, low-vision zoom and 390/1440px responsive layouts.

Documentation and runbooks: docs/OPERATIONS.md, docs/PROTOCOL.md, docs/DEVELOPER_ONBOARDING.md, and docs/PRODUCT_COMPLETENESS.md.
