# Change log (change control, doc 09 section 5)

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
