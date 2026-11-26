# AI technical review — 26 November 2026

**Status: completed source inspection by an AI assistant; NOT a human review, an independent smart-contract audit, or evidence that the founder personally reviewed code.** The founder may read and challenge this report, and record their own observations separately.

Scope and provenance: GitHub `main` at `2ee3ec0bc1589f85715b6ce7313dd552b316732e`, after merged PR #16. Read `contracts/TurnpikeAllowance.sol` (entire contract), `packages/mcp/src/pay.ts` (entire payer), `packages/mcp/README.md`, `OWNER_REVIEW_CHECKLIST.md`, `docs/DIFFERENTIATION.md`, and `evidence/M11_owner_cycle_2026-11-24.md`. This review did **not** execute tests, inspect a live wallet, obtain secrets, or submit transactions. Existing CI and transaction evidence are referenced rather than recreated.

## A. Solidity `pay()` — code-level findings

1. **Authorization and rules.** `pay(owner, merchant, requestId, amount)` loads the selected owner's account, rejects a paused account, requires `msg.sender == a.agent` and a nonzero configured agent, checks `allowedMerchant[owner][merchant]`, rejects zero amount, then enforces `perCallCap` and `dailyCap`. It checks replay and vault balance before transferring the token.
2. **Daily accounting.** The day index is `block.timestamp / 1 days` (UTC boundary). Spending is zeroed logically on a new UTC day; the rule is not a rolling 24-hour window. A buyer can spend near two daily allowances across midnight, subject to their remaining funded balance and per-call rules.
3. **Replay key.** `_used[merchant][requestId]` is not keyed by owner. It prevents a second use for the same merchant and request ID globally, but creates documented cross-owner collision/griefing exposure. Changing this requires a new contract; this contract has no upgrade function.
4. **Effects before interaction.** The function marks the request used and debits daily spend and account balance before `token.safeTransfer(merchant, amount)`, under `nonReentrant`. A reverted token transfer reverts those state changes too. `deposit` and `withdraw` also use `nonReentrant` and `SafeERC20`.
5. **Owner isolation.** Owner configuration and withdrawal functions operate on `msg.sender`'s account. `withdraw` does not check paused or agent status, so the owner can withdraw while paused or after revocation. There is no admin, upgrade or rescue function.
6. **Token assumption.** Deposits credit the requested amount before `safeTransferFrom`; this assumes the configured QUSDC behaves as a normal transfer amount token. It should not be characterized as generic compatibility with fee-on-transfer/rebasing tokens. QUSDC issuer privileges remain a trust assumption.

**Assessment:** The on-chain spending checks are substantive and coherent in the reviewed source. They do not establish the security of the exact deployed coverage-instrumented runtime; `evidence/M9_deployed_bytecode_verification.md` documents separate reproduction and fork checks, not an audit. The 5 QUSDC per-account deposit cap is not a security guarantee.

## B. Local MCP `Payer` — code-level findings

1. **Constrained destination.** `allowedUrl` and `guardedFetch` are passed from the read-side configuration. The client receives an explicit payee list and maximum price; a seller response is marked untrusted data in the result.
2. **Approval presentation.** When a payment quote is not approved, the payer returns a question displaying price, API URL, merchant, network, approximate gas, remaining daily budget and irreversibility. Its in-process pending approval token expires in five minutes and is consumed once.
3. **Re-approval checks.** On continuation the selected operation, purchase key, URL and `max` must match. The SDK approval callback requires the new quote to have the same URL and merchant, price no higher, and gas estimate at most twice that originally shown; it is not a blank cheque to change destination or price.
4. **Host trust boundary.** The method accepts an `accepted` flag and confirmation state from the MCP application. As the MCP README itself says, the app is trusted to display the prompt and convey the *person's* actual answer. The underlying contract enforces amount/merchant/policy limits, **not** a human-click attestation. An untrustworthy or autonomously confirming MCP host can defeat the intended human-approval UX; the package must not be marketed as independently proving a human approved.
5. **Uncertain results.** On timeout/unexpected failure, the result can say `paid: "unknown"` and instruct `turnspike_resume` rather than starting another purchase. When a payment is known to have settled but delivery failed, it says `PAID, NOT DELIVERED`. The journal's guarantees depend on using the same purchase key and keeping its record intact.
6. **Error semantics for follow-up.** In `describe()`, `good` is true whenever `r.kind === "paid"`, even if `r.response.ok` is false; the HTTP status is included separately. Verify that MCP clients do not interpret `ok: true` as a successful *API response* solely because the payment settled. This is a presentation/contract-of-API observation, **not a proven money-loss bug**.
7. **Operational limits.** Pending approval state is held in process memory, so an application restart can lose a not-yet-consumed approval question. MCP documentation warns that the keystore password in app settings is sensitive and that hosted MCP is read-only; no MCP mainnet payment has been documented.

**Assessment:** The local MCP payment tool has meaningful constraints, but human confirmation depends on a trustworthy host. No mainnet MCP payment or independent security audit is established. Before describing it to judges, say "the local MCP tool can pay after confirmation in a trusted MCP application"; don't imply the hosted read-only MCP can pay.

## C. Evidence and limitations

- `evidence/M11_owner_cycle_2026-11-24.md` records a project-operated real-wallet mainnet owner lifecycle and one CLI agent payment. This is **not external customer adoption** and was not repeated by this reviewer.
- The QIE contract is unchanged, deployed and unaudited. Refunds for paid-but-undelivered API calls are not automatic.
- Current Cloudflare gateway readiness/cutover is separately documented in `docs/CLOUDFLARE.md`; do not assume a successful Worker test or standby deployment means all live payments have moved from Fly.
- GitHub reported 14 check-run records for the merged PR #16 commit at the time of this inspection, of which one browser record had no recorded conclusion in the latest read. Do not label this a fresh 14-of-14 run without checking the live CI status.

## D. Recommendation (AI-prepared, founder's decision pending)

For `docs/DIFFERENTIATION.md`, recommend **PASS for the integrated product design only**: contract-enforced owner limits + signed resource-bound 402 + durable paid delivery/recovery + middleware, SDK, CLI, MCP and owner console. This is a recommendation, **not a claim of novelty for any one ingredient or of priority over unverified competitors**. The founder should choose and record their own decision after reviewing this evidence.

## E. What this does not attest

This memo does not tick the founder's owner-review checklist, enter the human contribution table, assert the founder ran Hardhat, attest to age or eligibility, sign any declaration, approve a video, or submit an application. AI-authored code review cannot be reclassified as the founder's personal developer contribution.
