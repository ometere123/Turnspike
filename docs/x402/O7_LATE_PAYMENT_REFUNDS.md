# O7: late-payment reconciliation and refunds (design)

Status: design only. Nothing here is implemented, no prototype was added, and no funds are moved by anything in this
repository. The vault (`TurnpikeAllowance`, deployed at `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` on QIE 1990) has no
refund, admin or rescue function (SEC-008) and is not changed. Every refund is therefore an ordinary **ERC-20 transfer of
QUSDC from the merchant's own wallet**.

## 1. Scope: which payments need a refund decision

| Class | How it arises | Source in the middleware |
|---|---|---|
| `PAID_LATE` | A valid Paid log (right contract, merchant, requestId and amount at least the price) mined after `expiresAt + paymentGraceSeconds`. The row is `REJECTED` with `disposition = 'PAID_LATE'` and records txHash, payer (owner), agent and blockNumber. | `processProof` and `reconcile()`, event `payment_paid_late` |
| `PAID_UNDELIVERED` | `PAID_CONFIRMED` but never `DELIVERED` within `staleSeconds`, for example because the handler kept failing or the agent vanished. | `paidUndelivered()` (0.2.0) |
| `UNDERPAID` / unsolicited | A Paid log for a known requestId that the seller refused (`amount_below_price`, `owner_not_permitted`, `agent_not_permitted`), including O6 griefing dust. | New: recorded by the refund scanner (section 6), not by the payment row |
| `OVERPAID` | The amount is above the price. The middleware accepts it. A refund of the excess is optional and set by policy. | New, from the Paid log amount compared with the row price |

Only `PAID_LATE` and `PAID_UNDELIVERED` are **refund-eligible by default**. `UNDERPAID` is held and not refunded unless an
operator decides otherwise (section 8, threat T1). `OVERPAID` excess is refunded only if the merchant's policy says so.

## 2. Ownership

**The merchant owns refunds.** The QUSDC is in the merchant's wallet the moment `pay` succeeds, and the vault cannot take it
back. Turnspike provides the ledger, detection, tooling and evidence. It never holds or moves merchant funds on its own
initiative.

## 3. Authorisation

| Action | Who | Key |
|---|---|---|
| Detect, open and classify a case | The seller process (automatic) | None. Read-only RPC. |
| Approve a refund | A named merchant operator, recorded by identity | The operator's credential on the refund API or CLI, never a chain key |
| Execute (sign the transfer) | A **separate refund signer** | A dedicated hot wallet funded by the merchant with a small float, or a multisig or custody signer for amounts above a threshold. **Never** the agent key, never the seller's HMAC secret, never the merchant cold key on the gateway host. |
| Cancel or void | A merchant operator | The same as approval |

Rules:
- Two people above a configurable threshold (`refund.dualControlAbove`, in base units): one approves, a different
  operator executes.
- The gateway (seller) process has **no signing key**. It writes `PROPOSED` cases. Only the refund executor, a separate
  process or CLI, can sign.
- The refund float wallet holds at most `refund.floatCap`, so a compromised executor loses at most the float.

## 4. Destination: the payer owner, not the agent

The refund goes to the **owner address from the Paid log** (`Paid.owner`, recorded as `payer` on the row).

Why:
- The money left the owner's vault balance. The agent never held it, and the agent key is a delegated, revocable,
  low-trust hot key (SEC-001). It may already be revoked or compromised.
- `Paid.owner` is an indexed fact emitted by the contract. It cannot be chosen by whoever asks for the refund.
- The refund cannot go back into the vault account directly: `deposit` credits `msg.sender`. A plain transfer to the owner
  EOA is the only honest return path. The owner can redeposit.

The destination is **never** taken from a request, email, ticket or HTTP header. It is derived from the chain log only
(threat T2). If the owner address is a contract that cannot receive ERC-20, or is on a sanctions or deny list, the case goes
to `HELD` for manual handling.

## 5. Double-refund prevention: a durable state machine

### 5.1 Key

`refundKey = chainId : txHash : logIndex` (lower case). One Paid log can be refunded at most once, regardless of
requestId, row state or how many times the case was detected. `requestId` is stored, but it is not the key: an O6 dust
payment and the legitimate payment can share a requestId.

### 5.2 States

```
DETECTED -> PROPOSED -> APPROVED -> SUBMITTED -> CONFIRMED (terminal)
    |           |           |           |
    +-> HELD <--+           |           +-> FAILED -> APPROVED (retry, same idempotency id) or VOIDED
    +-> VOIDED (terminal)  -+-> VOIDED
```

- `DETECTED`: written by the scanner, idempotently (`INSERT ... ON CONFLICT(refundKey) DO NOTHING`).
- `PROPOSED`: the payment has enough confirmations (at least `refund.minConfirmations`, default 2 times the seller's
  confirmations), it is eligible, and the amount and destination are computed.
- `APPROVED`: an operator approved it (who, when and why are recorded).
- `SUBMITTED`: the executor has **first** recorded `refundNonce`, `fromAddress` and the signed transaction's hash in the
  ledger, and only **then** broadcasts it. This is write-ahead, the same pattern as the client journal's
  `paying` to `broadcast` sequence.
- `CONFIRMED`: the refund transfer has at least `refund.minConfirmations` confirmations and its `Transfer` log matches
  token, from, to and amount.
- `FAILED`: the transaction reverted, or its nonce was consumed by something else. Only then may it go back to `APPROVED`.
- `HELD`: manual review is needed (underpayment, destination problem, reorg).
- `VOIDED`: decided not to refund. Terminal, with a reason.

### 5.3 Idempotency rules

1. Every transition is a compare-and-set (`UPDATE ... WHERE refundKey = ? AND state = ?`). Zero changed rows means another
   worker won.
2. A case in `SUBMITTED` is **never** re-signed with a new nonce. Recovery reads the chain: either the recorded transaction
   hash or nonce mined (go to `CONFIRMED` or `FAILED`), or the nonce is still free (rebroadcast the **same** signed
   bytes).
3. The executor holds an exclusive lease per signer address, so it is the only nonce allocator for the float wallet.
4. API calls carry an `Idempotency-Key`. Repeating the same approval or execution returns the stored result.
5. A ledger-level sum check runs before signing: the total refunded for a txHash plus this refund must not exceed
   `Paid.amount`.

## 6. Detection and reconciliation

- **The PAID_LATE source** is the middleware rows (`disposition = 'PAID_LATE'`) together with a periodic `reconcile()`.
- **The independent scanner** reads `getLogs(Paid, merchant topic)` from `reconciledBlock` up to head minus
  confirmations, joins the results to the payment rows by requestId, and classifies each log: delivered, PAID_LATE,
  underpaid, unknown requestId, overpaid. A log it cannot match to a delivered row becomes a `DETECTED` case.
- **Reorg handling:** cases are only `PROPOSED` after `refund.minConfirmations`. Before executing, the executor re-reads
  the receipt and checks that the block hash is still canonical (the same guard as `verifyPayment`).

## 7. Accounting records and export

Each case stores: refundKey, chainId, contract, token, merchant, requestId, resourceId, priceBase, paidAmount, refundAmount,
paidTxHash, paidLogIndex, paidBlockNumber, paidBlockHash, paidAt, owner (the destination), agent, class, state, every
transition with (from, to, actor, reason, at), approver, executor, refundTxHash, refundNonce, refundBlockNumber and
refundConfirmedAt.

- The transition table is append-only. The state column is derived and stored for queries.
- Export: `turnspike refunds export --from --to --format csv|jsonl`. Amounts are in base units and in display units with 6
  decimals. Explorer links are included. The output is stable and sorted by `paidBlockNumber, paidLogIndex`.
- Daily totals: received, refunded, held and voided. They must balance against the merchant's on-chain QUSDC `Transfer`
  history from the vault and to refund destinations.

## 8. Monitoring and alerts

| Metric | Alert |
|---|---|
| `paid_late_open_count` (cases not terminal) | Above 0 for more than 1 h: warn. Above `N`: page. |
| `paid_late_oldest_age_seconds` | Above the SLA (default 24 h to `CONFIRMED`): page. |
| `refund_submitted_age_seconds` | Above 15 min without confirmation: warn (stuck nonce). |
| `refund_failed_count` | Any: warn. |
| `underpaid_count` per hour (O6 griefing signal) | Above baseline: warn. Include top owners. |
| `refund_float_balance` | Below the next 24 h of expected refunds: warn. |
| `reorg_after_refund` | Any: page (T3). |

SLA: a `PAID_LATE` or `PAID_UNDELIVERED` case is refunded (`CONFIRMED`) within 24 h of detection, or explicitly `VOIDED` or
`HELD` with a reason.

## 9. CLI and API surface

CLI (`packages/cli`, future):

```
turnspike refunds scan [--from-block N]            # detect, idempotent
turnspike refunds list [--state S] [--class C]
turnspike refunds show <refundKey|requestId|txHash>
turnspike refunds approve <refundKey> --reason "..." [--amount base]
turnspike refunds hold|void <refundKey> --reason "..."
turnspike refunds execute <refundKey> --signer <keystore|kms-uri> [--dry-run]
turnspike refunds recover                         # settle SUBMITTED cases from the chain
turnspike refunds export --from --to --format csv|jsonl
```

HTTP API (an admin listener separate from the public seller port, with operator authentication, audit-logged):
`GET /refunds`, `GET /refunds/:key`, `POST /refunds/:key/approve`, `POST /refunds/:key/hold`, `POST /refunds/:key/void`.
There is **no** HTTP execute endpoint. Execution happens only through the executor or CLI that holds the signer.
`execute --dry-run` prints the exact transfer (token, to, amount, nonce) and signs nothing.

## 10. Threat model

| # | Threat | Control |
|---|---|---|
| T1 | **Refund to the attacker.** An O6 griefer pays 1 unit, or underpays, and then asks for a refund. Or an attacker pays a late transaction for someone else's requestId and collects a "late refund". | The destination is always `Paid.owner`, so a griefer can only ever get back their own dust. `UNDERPAID` defaults to `HELD`, not refunded. Refunds are capped at `Paid.amount` per log. A refund pays back the payer of that specific log, which is correct even when the payer is not the original requester: they paid, and they get their own money back. |
| T2 | **Social engineering.** "Refund to this other address", "the agent key was lost, send it to X", fake support tickets. | The destination cannot be overridden through the API. A different destination needs a `HELD` case and an out-of-band proof of control of `Paid.owner` (a message signed by the owner), plus dual control. |
| T3 | **Reorg after refund.** The original Paid log disappears after the refund is sent. | `minConfirmations` before `PROPOSED`. The canonical block hash is re-checked immediately before signing. If a reorg is detected after `CONFIRMED`, raise the `reorg_after_refund` page, mark the case `HELD`, and recover manually (the merchant's float bears the loss, bounded by `floatCap`). QIE finality makes this unlikely after a few blocks. |
| T4 | Double refund through concurrency or a crash | Section 5: one key per log, CAS transitions, a write-ahead `SUBMITTED`, the same signed bytes on rebroadcast, and a single nonce allocator. |
| T5 | Executor key compromise | A small float, a separate key, dual control above the threshold, and alerts on any transfer from the float wallet without a matching `SUBMITTED` case. |
| T6 | Refund of a delivered purchase (the buyer received content and also asks for money back) | Eligibility excludes `DELIVERED` rows. A commercial refund of a delivered item is a manual `HELD` decision. |
| T7 | A wrong token or chain sends the refund to the wrong place | The executor pins `chainId` and the token address from config and checks them against the case, and checks `Transfer` logs on confirmation. |

## 11. Test plan (all on local Hardhat; never real funds)

1. A PAID_LATE case is detected from `processProof` and from `reconcile()`, and appears exactly once (same txHash and
   logIndex detected twice give one case).
2. The destination equals `Paid.owner` even when the agent is different or revoked. An API attempt to set a destination
   is rejected.
3. An O6 underpayment leads to a `HELD` case of class `UNDERPAID`, which is not auto-proposed.
4. Approve, then execute, then confirm: the `MockERC20` balances move by exactly the refund amount, and the case is
   `CONFIRMED` with the `Transfer` log matched.
5. Crash injection: kill the executor after `SUBMITTED` is written and before broadcast, and after broadcast and before
   confirmation. `recover` gives exactly one transfer in both cases.
6. Two executors race for the same case: one transfer, and the loser sees a CAS failure.
7. Repeating the same approval or execute call with the same `Idempotency-Key` returns the stored result, with no new
   transfer.
8. Reorg: use `evm_snapshot` and `evm_revert` to remove the Paid log before execution. The executor refuses and the case
   is `HELD`. Removing the log after `CONFIRMED` raises the alert.
9. A refund amount above `Paid.amount`, or a cumulative over-refund, is refused.
10. Dual control: the same operator cannot both approve and execute above the threshold.
11. Export: the CSV and JSONL totals reconcile against on-chain Transfer logs on the local chain.
12. Alerts: synthetic aged cases trigger the age and SLA alerts.

## 12. Out of scope

- No contract change, refund function or redeploy (that would need the owner's approval).
- No prototype ledger in this change. If one is added later, it must live under a test directory, use `MemoryJournal`-style
  storage, and run only against local Hardhat.
