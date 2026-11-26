# Change log (change control, doc 09 section 5)

## 2026-11-26: Released
PR 15 merged (`1086400`) and deployed to the site. `@turnspike-qie/mcp` 0.1.0 and `@turnspike-qie/middleware` 0.1.1 published on npm by the owner, matching the built tarballs.

## 2026-11-25: MCP server; middleware 0.1.1 (README only, same code)
A separate tool on the published client. No contract, protocol, gateway, middleware, client or CLI change.
- `packages/mcp`: three read-only tools; pay and resume only when switched on, each payment confirmed by a person (MCP-01 to MCP-12).
- `apps/mcp-cf`: the read-only tools on Cloudflare, https://turnspike-mcp.delealufejoel.workers.dev/mcp (deployed 2026-11-25 on the owner's instruction, version `2c9dc8b6`). No key, no secret, no payment code.

## 2026-11-24: Pre-submission pass
No contract, protocol, middleware, client or CLI change.
- Cloudflare gateway: an import from a later copy moves records forward instead of being refused; full cutover and rollback rehearsal (CUT-01, CUT-02).
- Site: evidence page lists M10 and M11; wording about the demo agent's key and the Node version.
- Slides rebuilt and checked by rendering; video re-cut; submission and decision documents brought up to date.
- Correction: gas of the six owner transactions in M11.

## 2026-11-24: Product release candidate (PR #8)
No contract, protocol, middleware source, client or CLI change.
- Operations center: an answer always belongs to the value beside it (edits cancel reads in flight); RPC reads time out after 12 s; pending, settling and lagging-RPC states; canonical check before any verdict; request-ID and hash mismatches are errors; a gateway with another chain, vault or token is an error; unknown values stay unknown.
- Owner console: the review shows network, account and the exact contract; the wallet's account and network are checked again at signing and a change cancels the review; confirmation is read from the QIE RPC, and a lost confirmation is "Outcome unknown" with no Retry instead of "Failed"; switching accounts clears forms, balances and session receipts; a late refresh for a previous account is ignored; only plain 0x addresses are accepted; the RPC's chain is checked; failed reads say what is and is not current; focus returns to the control that opened a review.
- QIE ID: any second listed name is ambiguity, even if it is malformed; network failure is stated.
- Playground: a lost answer is "Outcome unknown", not "Refused"; a rate limit is not reported as an outage.
- Accessibility: scrollable code, tables and the diagram are keyboard reachable; button contrast on the yellow band in dark mode.
- Build: fonts are vendored, so a build does not need Google Fonts.
- Tests: browser suite `apps/web-e2e` and its CI job; web unit tests OPS-1 to OPS-15; TEST-BAK-1 (backup, loss, restore).
- Documentation: the backup section claimed a restored database loses no payment that reached the chain. That is false for challenges issued after the backup; corrected, and pinned by TEST-BAK-1.
- x402 (PR #7): not merged; decision in `X402_DECISION.md`.

## 2026-11-19 — Client SDK payment safety (@turnspike-qie/client 0.1.1 and @turnspike-qie/cli 0.1.1, published to npm 2026-11-19 from merge commit ff7ce56)
Follow-up to an independent review. Client: expiry re-checked immediately before broadcast (slow approval); ambiguous submission errors keep the journal record in `paying` and return `payment_pending` instead of `failed`; resume re-runs payee, network, price, owner-policy, gas and `approve` checks before paying a never-sent challenge, and only marks it failed when no charge is possible; idempotency keys are bound to method, URL and body (`idempotency_conflict`). CLI: `payment_pending` and `tx_timeout` exit with 4 and print the resume command. Gateway: counterparty ranking moved to `apps/gateway/src/activity.ts` with tests. Tests: CL-10b, CL-17 to CL-21, ACT-1, ACT-2. No contract, deployment or published-package change.
Second review round (same unpublished 0.1.1): idempotency keys are claimed atomically before a challenge is requested (`Journal.swap`; `FileJournal` now locks every read-modify-write), so concurrent calls with one key cannot pay two requestIds; abandoned reservations are taken over after `reservationTimeoutSeconds` with fencing. A submission of unknown outcome whose challenge has expired now returns `payment_pending` with `maybePaid: true` (previously `challenge_expired`, "not paid"), and a re-send after an uncertain submission must reuse the recorded nonce and never marks the record failed. Results gain `maybePaid`; the CLI exits 4 for every `paid` or `maybePaid` result. 0.1.0 journal records (no fingerprint) are reused only for a body-less GET or HEAD of the same URL. Tests: CL-22 to CL-25, CLI-11.
Third review round (same unpublished 0.1.1): `Journal.swap` now compares a per-record revision (`rev`) instead of a lock token, so a takeover succeeds only while the record is still the exact reserved revision that was read. Every client journal write is conditional on the revision read, except chain facts (broadcast, confirmed, delivered), which only move forward; a stale worker's `failed` can no longer overwrite a newer state, and a revert is checked against `isUsed` before a record is closed. `FileJournal` no longer removes locks by age: only a lock whose owner pid on this host has exited is reaped, under a second exclusive lock; it takes `lockWaitMs`. Tests: CL-26 to CL-28, J-1 to J-6 (J-6 races two OS processes).
Fourth review round (same unpublished 0.1.1): journal records carry an immutable purchase-attempt id (`attempt`; 0.1.0 records fall back to the challenge requestId). Forward-only facts are applied only to the same attempt, and a stale worker that meets a different attempt reports its own requestId as `maybePaid` instead of resuming the newer attempt. Tests: CL-29 (failed-key reuse, then the old attempt's delayed broadcast, confirmation and delivery), CL-30 (stale worker against a newer attempt).
Documentation correction: the idempotency guarantee is per purchase attempt. Both attempts can charge if a record is marked failed by anything other than the client while a transaction is in flight (CL-29 demonstrates this with an injected failure); a superseded attempt loses journal-based recovery and its transaction hash may not have reached its caller. An audit of every automatic `failed` write found none that releases a key while a payment could still succeed.

## 2026-11-19 — Submission-readiness review
Fresh review recorded in `docs/CODEBASE_REVIEW.md`. Fixes: the client SDK `resume()` no longer pays a never-broadcast challenge that has expired (test CL-11b); `/v1/qusdc-activity` orders counterparties with bigint comparison. Docs: payment grace corrected to 60 s in README and the review log; test counts updated; hackathon deadline corrected to 23:59 CET. Added: `OWNER_REVIEW_CHECKLIST.md`, `docs/OWNER_DECISIONS.md`, `docs/DEVELOPER_ONBOARDING.md`, `docs/submission/`, `docs/screenshots/`. No contract, package version or deployment change.

## 2026-11-19 — RD-1 recorded: replace, reuse mechanism and test cases
The Stage 4 contract (`0x6910…DdAC`, single-tenant, `pay(merchant,requestId,amount)`) is not the submission contract. The final contract `contracts/TurnpikeAllowance.sol` is a new multi-tenant file (`pay(owner,merchant,requestId,amount)`), per DEC-4 and DEC-7. The validated mechanism (per-call cap, replay key, Paid event) and its test cases were carried over. Effect on schedule: none. Amendment 6 satisfied.

## 2026-11-19 — Spec addition: `pay` reverts on `amount == 0` (`ZeroAmount`)
Not listed in doc 06; added to avoid zero-value requestId consumption. No effect on SEC invariants.

## 2026-11-19 — Stage 4 evidence imported
`evidence/stage4/` holds the Stage 4 reports (no secrets). QUSDC source shows no pause, blacklist or transfer tax; only role-gated mint/burn. This is source-reading, not an execution test (TEST-X02 stays open).

## 2026-11-19 — Frontend and hosting
Next.js frontend added in `apps/web` and deployed to Vercel (https://turnpike-qie.vercel.app). Gateway hosted on Fly.io (https://turnpike-qie.fly.dev) with a persistent volume (OD-4 decided: Fly.io for the gateway, Vercel for the frontend). No contract or security-logic changes.

## 2026-11-19 — Payment-proof, delivery and demo hardening (follow-up to an independent review)
Reason: a review found that the middleware accepted a missing challenge signature, could replay a stored response before validating the proof, treated an expired challenge as final even when the payment was on-chain, and sent responses before recording delivery. The public demo endpoint also had no authentication or spending bound.
- Proof: `sig` is now mandatory and checked (timing-safe) before any replay or verification; `txHash` must match the stored transaction before a replay is served; the proof is strict (no extra fields, size-limited).
- Expiry: judged on the payment's block time with `lateGraceSeconds` (default 86400), so a late proof for an on-time payment is honoured. Payments beyond the window are `REJECTED`, recorded with their transaction, and counted as paid-but-undelivered.
- Delivery: new `DELIVERING` state with a lease (`deliveryLeaseSeconds`); the response is written durably before it is sent; a failed or non-2xx handler releases the lease; storage failures answer 503. Handlers are documented as at-least-once.
- Verification: reorg guard (receipt block must still be canonical), `allowedOwners` and `allowedAgents` payer binding, refusals that concern only a presented transaction no longer poison the request.
- Store: additive migration (`agent`, `leaseUntil`), fsync on commit, periodic purge of unpaid challenges.
- Gateway: validated configuration (zod), second paid endpoint `GET /v1/address/:address`, CORS allowlist, redacted errors; demo endpoint now needs a solved proof-of-work puzzle, per-visitor hourly and daily quotas, a shared daily transaction budget and a minimum agent gas balance, all persisted in SQLite, plus a kill switch; new read-only `unauthorized-merchant` scenario (eth_call).
- Spec impact: `X-Payment` becomes `base64({requestId, txHash, sig})` (doc 06 section 4); state machine gains `DELIVERING` (doc 05 section 5). The deployed contract was not changed. Cross-owner request-ID collision (finding N1) is documented; a per-owner replay key would need a redeploy and was not done.
- Tests: 39 passing (was 21). Hosted gateway redeployed on Fly.io and verified (see `evidence/M7_live_demo.json`).

## 2026-11-19 — Frontend consolidation and packaging
The single-page Vite playground was removed; `apps/web` (Next.js) is the only public UI. Next.js upgraded to 15.5.x and React to 19 to clear production advisories (0 remaining in `npm audit --omit=dev`). The middleware is packaged as `@turnpike/middleware` (not published to npm) with a runnable example in `examples/express-api`. The gateway Docker image now ships compiled JavaScript and production dependencies only. CI covers contracts, middleware, gateway, web (type-check, lint, build, audit), the package and example, and best-effort Slither.

## Rename: Turnpike to Turnspike (user-facing)
The product name is Turnspike. Renamed: README, web UI text and metadata, middleware package (`@turnspike-qie/middleware`, function `turnspike`, with deprecated `turnpike` alias), example, CI, scripts, owner docs, log env var (`TURNSPIKE_LOG`; `TURNPIKE_LOG=off` still honoured).
Deliberately unchanged: the deployed contract and its source/artifact name `TurnpikeAllowance` (address, ABI, events untouched), `evidence/` and the historical spec docs `docs/00` to `docs/16`, research notes, earlier changelog entries, and live infrastructure names (Fly app `turnpike-qie`, volume `turnpike_data`, DB file `turnpike.sqlite`, Vercel URL `turnpike-qie.vercel.app`), because renaming them would move URLs or orphan stored data.

## 2026-11-19: SDK, CLI and payment lifecycle corrections
- **Infrastructure rename.** Gateway moved to Fly app `turnspike-qie` (https://turnspike-qie.fly.dev) with volume `turnspike_data`; the database was copied with a SQLite backup (checksums matched) and secrets were copied server to server. The old app `turnpike-qie` is stopped with autostart off, not deleted. Vercel project renamed to `turnspike-qie`; https://turnspike-qie.vercel.app is primary and the old domain redirects (308).
- **Payment deadline vs redemption (was a 24 h grace).** A payment must be mined by `expiresAt + paymentGraceSeconds` (default 60 s). Redeeming an in-time payment has no deadline. `lateGraceSeconds` remains as a deprecated alias.
- **Retention vs recovery.** `reconcile()` scans `Paid` logs for the merchant and attaches payments that arrived without a proof (e.g. during an outage). `purge()` deletes an unpaid challenge only after its deadline, a reconcile past it, and `retentionSeconds` (default 30 days). Previously unpaid rows were deleted after 24 h regardless.
- **Delivery lease fencing.** Leases now carry a token, are renewed while the handler runs, and a stale holder can neither complete, renew nor release. A superseded run serves the stored response, never its own.
- **Response fidelity.** Bodies are stored as bytes (base64), with an allowlist of headers; cookies are never stored. Size is enforced while buffering. Legacy text rows still replay.
- **Request binding and validation.** Default binding is method + path + sorted query; optional body hash and caller identity. `validate()` runs before a challenge, so invalid input (e.g. `/v1/address/not-an-address`) is refused with 400 and can no longer be paid for.
- **Protocol fields.** Challenges carry `protocol: "turnspike/1"` and `paymentDeadline` (additive).
- **New packages.** `@turnspike-qie/client` (agent SDK) and `@turnspike-qie/cli` (`turnspike`). New examples: `node-agent`, `end-to-end`. New paid endpoint `/v1/qusdc-activity/:address`.
- **Docs.** `PROTOCOL.md`, `OPERATIONS.md`, `INTEROPERABILITY.md`; differentiation draft revised (owner decision still open).

## 2026-11-19: npm publication
`@turnspike-qie/middleware`, `@turnspike-qie/client` and `@turnspike-qie/cli` 0.1.0 published from the `converts` account under the `turnspike-qie` org (the `@turnspike` scope belongs to another account). Verified by installing all three into an empty folder: the SDK loads, `turnspike account inspect` reads mainnet, and an Express app using the published middleware answers a real `turnspike/1` 402.
