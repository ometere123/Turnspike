# O6: requestId griefing

Status: investigated on local Hardhat with the real contract, middleware and client. Verdict: **risk accepted (low)**, with
one client defect, F1 (section 5), now fixed. No contract change is needed or proposed. The deployed vault
(`0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c`, QIE 1990) was not touched.

## 1. Claim

`TurnpikeAllowance` stores its replay key as `_used[merchant][requestId]`, global across owners. A third party with their
own owner and agent account can call `pay(theirOwner, merchant, requestId, 1)` before the victim and consume the victim's
pending requestId.

## 2. Evidence

Test: `packages/x402/test/o6-requestid-griefing.spec.ts` (15 tests, all pass). It runs a Hardhat node on port 8721,
deploys `TurnpikeAllowance` and `MockERC20` from `artifacts/`, mounts the real middleware through `x402Seller`, and drives the
victim with the real `TurnspikeClient` behind `createX402Fetch`. The attacker is one EOA acting as its own owner and agent.

```
cd packages/x402 && npx vitest run test/o6-requestid-griefing.spec.ts
```

The run prints an `O6_EVIDENCE` JSON block. The figures below come from it.

### 2.1 Preconditions for the attacker

| Check | Result |
|---|---|
| Attacker's account without the merchant on its allowlist | `pay` reverts `MerchantNotAllowed`; `isUsed` stays false. **The attacker must allowlist the merchant on their own account.** |
| Attacker spends from the victim's owner account | Reverts `NotOwnerAgent`. |
| Cost to set up | One `setMerchant(merchant, true)` on the attacker's own account. No merchant consent is needed. Also needed: a deposit of at least 1 base unit, and `setPolicy` with the attacker as their own agent. |

The order of checks in `pay` matters: `RequestAlreadyUsed` is evaluated only after the paused, agent, allowlist, zero,
per-call cap and daily cap checks for **the caller's own account**. The attacker controls all of those, so they are not a
barrier.

### 2.2 Entropy and observability of the requestId

- `requestId = keccak256(abi.encode(nonce, merchant, resourceId, price, chainId, contract, expiresAt))`, where `nonce` is
  `randomBytes(32)` (`packages/middleware/src/challenge.ts`). There are 256 bits of fresh randomness per challenge. In the
  test, 20 challenges for the same URL gave 20 distinct ids. The id cannot be guessed or precomputed.
- Before payment the requestId exists only in the 402 response (JSON body and `PAYMENT-REQUIRED` header,
  `cache-control: no-store`) and in the seller's database. Nothing is on chain.
- After the victim broadcasts, the requestId is in clear in the pending `pay` calldata, so any mempool observer sees it.

There are only two ways for an attacker to obtain a victim's requestId:
- **A. A leaked 402**: logging proxies, shared caches that ignore `no-store`, a compromised agent host, or a seller that
  logs challenges where others can read them.
- **B. The mempool**: front-running the victim's broadcast `pay`.

### 2.3 Case A: the 402 leaks before the victim pays

| Question | Observed |
|---|---|
| Does the victim's pay revert? | It is never sent. The client's quote reads `isUsed(merchant, requestId)` and fails with `already_paid` ("this requestId is already paid on chain"), `paid: false`, `maybePaid: false`. |
| Is the victim charged? | No. QUSDC charged: 0. Gas spent: 0, because the transaction was refused before broadcast. |
| What does the seller do with the 1-unit payment? | A proof presenting the attacker's tx gets HTTP 402 `invalid_turnspike_allowance_amount_below_price`. The handler never runs. The row is **not** marked paid, no txHash is bound to it, and it is not `PAID_LATE`. Events: `payment_rejected:amount_below_price`. |
| `reconcile()` | It finds the attacker's Paid log by requestId, verifies it, and refuses it (`recovered: 0`). The row ends in `PAID_PENDING` with no txHash, and is never delivered. |
| Can the attacker get delivery? | Not with an underpayment. With a full-price payment and the leaked `sig`, yes: see 2.5. |
| Does the agent recover? | **Yes, within the same call.** `createX402Fetch` treats `already_paid` with `paid: false` as "request one fresh challenge" (bounded to one retry, event `x402.agent.retry` with reason `fresh_challenge:already_paid`) and pays the new challenge. The victim is charged exactly once, for the new challenge; the leaked requestId costs the victim nothing. A later call with the same key returns the delivered purchase without paying again. |
| Attacker cost | 1 base unit (to the merchant, not recoverable) plus about 142k gas for the first `pay` (cold storage) and about 88k after that. |

### 2.4 Case B: mempool front-run of a broadcast pay

The test turns automine off, lets the victim broadcast, reads the requestId from the pending calldata, sends the
attacker's `pay(attacker, merchant, requestId, 1)` with a higher fee, and mines one block.

| Question | Observed |
|---|---|
| Does the victim's pay revert? | Yes. It is mined in the same block, after the attacker's transaction, with status 0. Replaying it gives `RequestAlreadyUsed(requestId)`. |
| Is the victim charged? | No QUSDC. The revert happens before any state change or transfer. The victim's agent pays gas only: about 43.9k gas. |
| Attacker cost | 1 base unit plus about 88k gas at a higher fee (in the test, about 5.8 times the victim's gas cost in wei). |
| Seller | As in case A. The 1-unit payment is refused, and the row stays open and undelivered. |
| Does the agent recover? | **Yes, within the same call (F1 fixed).** The client sees its own mined, reverted receipt, `isUsed` true and no Paid log for this owner and agent, marks the record `failed` with `request_used_by_other_payer` and returns `paid: false`. `createX402Fetch` then requests one fresh challenge and pays it: two broadcasts, one reverted (gas only) and one paid, and the owner is charged exactly once. Before the fix the client returned `payment_pending` with `paid: true`, left the journal in `broadcast`, and blocked the key forever. |

### 2.5 Controls

- **Payer binding.** A seller configured with `allowedOwners: [victimOwner]` refuses the attacker's transaction with
  `invalid_turnspike_allowance_owner_not_permitted`, even at full price.
- **Bearer proof.** Without payer binding, a third party who pays the **full** price for a leaked challenge and presents
  the leaked `sig` gets HTTP 200. That is an ordinary purchase by the attacker, but it also consumes the victim's challenge.
  The resource is whatever `resourceId` the victim asked for (path and query), so a seller whose resources are
  caller-specific should set `allowedOwners` or `allowedAgents`, or authenticate the caller separately.

## 3. Analysis

- **Theft:** none. The vault only ever debits the caller's own account. The victim's QUSDC never moves for a consumed
  requestId, and an underpayment never unlocks delivery.
- **Liveness:** an attacker who sees requestIds can make specific purchases fail. It costs them 1 unit plus gas per
  attempt, while the victim's loss is zero (case A) or one reverted transaction's gas (case B). The victim needs one extra
  round trip (made automatically by `createX402Fetch`).
- **Scalability of the attack:** low. Case A needs a confidentiality failure on the victim's or the seller's side. Case B
  needs a mempool watcher and costs the attacker more gas than the victim, every time. Nothing makes it cheaper at scale:
  each requestId is single-use and unpredictable.
- **Merchant side effect:** each grief deposits 1 unit with the merchant as an unattributable payment. The design for that
  money is in `O7_LATE_PAYMENT_REFUNDS.md`. It is not refunded automatically.
- **Seller state:** a refused underpayment found by `reconcile()` leaves the row in `PAID_PENDING` with no txHash. It is
  not delivered and is harmless, but `reapIssued` only removes `ISSUED` rows, so such rows linger until `purge`. This is
  noted for housekeeping only.

## 4. Verdict

**Accepted, low severity.** It is a griefing and liveness issue with no loss of funds and no unauthorised delivery. It needs
either a leaked 402 or an active mempool front-runner paying more gas than the victim, and it is fully recoverable by
requesting a new challenge. The contract stays as deployed. Changing the replay key to include `owner` would need a
redeploy, which is out of scope without the owner's approval, and would not remove the bearer nature of the proof anyway.

## 5. Mitigations (no contract change)

| # | Where | Mitigation | Status |
|---|---|---|---|
| F1 | client (`confirmAndRedeem`) | When the agent's own transaction receipt shows a mined revert, `isUsed` is true and `findPaidTx` (filtered by owner, agent and merchant) finds nothing, the requestId was consumed by **another payer**. The record is marked `failed` with `request_used_by_other_payer` and the call returns `paid: false` (no `maybePaid`). Guards: a receipt that is not found yet is still `maybePaid` (`tx_timeout`); the revert is classified only if the receipt is read again, still has status 0 and the same block hash, that block is still canonical, and the head has reached it. The `isUsed` read and the Paid scan are repeated at one block height (`blockTag: head`), so a lagging or load-balanced node cannot report the requestId as used by this owner's own competing transaction while the scan misses its log (independent review). A receipt that disappears or moves (reorg) returns `payment_pending` with `maybePaid: true` and the record stays `broadcast`. The `paying` branch of resume (nonce consumed, hash never recorded) is unchanged. | **Fixed.** Tests: case B, "F1: a resumed front-run attempt...", and the two "F1 guard" tests. |
| M1 | x402 agent | `createX402Fetch` treats `request_used_by_other_payer`, or `already_paid` with `paid: false` and no `maybePaid`, as "request one fresh challenge", bounded to one retry, and emits `x402.agent.retry` with reason `fresh_challenge:<code>`. | **Implemented** |
| M2 | seller | Ignore Paid events whose amount is below the price or whose owner or agent is unexpected. This is already the behaviour: `amount_below_price` is refused, the row is never marked paid, and it is not `PAID_LATE`. Also log `requestid_consumed_by_underpayment` (requestId, txHash, owner, amount) so operators see griefing and can account for the dust. | Mostly in place, proposed log |
| M3 | seller | When a seller sees a refused underpayment on a row, mark the row as burned and answer that requestId with a fresh 402 rather than a terminal refusal, so even naive agents recover. | Proposed |
| M4 | seller config | Sellers whose content is caller-specific should set `allowedOwners` or `allowedAgents`. This defeats full-price theft of a leaked challenge (2.5) and makes third-party underpayments easy to classify. | Documented (packages/x402/README.md) |
| M5 | client | Keep the pre-broadcast `isUsed` and `estimateGas` checks. They are why case A costs the victim nothing. A private or protected RPC submission path, where QIE offers one, would remove case B. | In place / optional |
| M6 | operations | Never log full 402 bodies or `PAYMENT-REQUIRED` headers at the seller or in agent proxies. Keep `cache-control: no-store` (already set). | Operational |
| M7 | cost to the victim | Zero in case A, because the client refuses before broadcast. In case B it is bounded to one reverted `pay` (about 44k gas), because the contract checks `RequestAlreadyUsed` before any effect or transfer. | Verified |

## 6. Files

- `packages/x402/test/o6-requestid-griefing.spec.ts`: the reproducible adversarial test (local Hardhat only).
