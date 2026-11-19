# Human review and contribution log

The hackathon requires genuine developer contribution and disallows predominantly AI-generated work (HR-008, process rule PR-2). This file is for the project owner to keep honest, first-person records. The assistant cannot fill it in on the owner's behalf, and nothing here should be read as a claim that a review happened unless the owner has recorded it.

## AI assistance disclosure (accurate as of 2026-11-19)
An AI coding assistant wrote the first version of: the Solidity contract and its tests, the middleware, the gateway, the demo agent, the client SDK, the CLI, the examples, both frontends, the CI, the deployment configuration and most documentation edits made since the specification. The owner supplied the specification, approved scope, funded the demo wallets, and pointed the assistant at the deployment accounts. The Stage 4 proof-of-mechanism contract and its mainnet run predate this build.

## Contract decisions the owner should be able to explain
Each is a choice made while drafting `TurnpikeAllowance.sol`. Review, challenge or change them, then tick.
- [ ] Multi-tenant accounts keyed by `msg.sender`; every owner function acts only on the caller's own account (SEC-001).
- [ ] `pay(owner, merchant, requestId, amount)` check order: paused, agent, allowlist, zero amount, per-call cap, daily cap, replay, balance; then effects; then transfer.
- [ ] Replay key is `(merchant, requestId)` and cannot be unset; cross-owner collision risk is documented, a per-owner key was not adopted.
- [ ] Daily cap uses fixed UTC days (`block.timestamp / 86400`), so up to 2x can pass across midnight (DEC-2).
- [ ] `pay` rejects `amount == 0` (an addition to the specification, logged in `CHANGELOG.md`).
- [ ] Withdraw is never blocked by pause or revoke (DEC-3).
- [ ] No admin, upgrade or rescue function (DEC-1).

## Gateway decisions the owner should be able to explain
- [ ] The `sig` is mandatory on every redemption and is the secret half of the proof.
- [ ] A payment is honoured if mined within 60 s (chain time) after the challenge expiry; a proof presented later is still accepted.
- [ ] Handlers are at-least-once with a delivery lease; the response is persisted before it is sent.
- [ ] Public demo protection: proof of work, per-visitor quotas, a shared daily transaction budget, a gas floor.

## Decisions waiting for the owner (prepared 2026-11-19, none taken on the owner's behalf)
The owner proposed a choice for each of these on 2026-11-19; the proposals are written out in `docs/submission/FOUNDER_DECISIONS.md` and become decisions when the owner signs that file. Releases already performed are noted as facts.
- [ ] Differentiation PASS or FAIL (`docs/DIFFERENTIATION.md`).
- [ ] Publish `@turnspike-qie/middleware`, `@turnspike-qie/client` and `@turnspike-qie/cli` to npm under the `@turnspike-qie` org owned by `converts` (the `@turnspike` scope belongs to another account). Fact, for the owner to confirm and log: 0.1.0 of all three and client 0.1.1 were published with the owner's passkey approval; CLI 0.1.1 was published by the owner from their PC on 2026-11-19 (the registry shows it at 20:11 UTC).
- [ ] Any contract change or redeploy (per-owner replay key, signed authorizations for an x402 scheme). None was made.
- [ ] Mainnet spending beyond the small project-wallet test runs recorded in `evidence/`.
- [ ] Key custody: the demo agent key lives as a Fly secret; the SDK and CLI read agent keys from encrypted keystores only.
- [ ] Delete the stopped Fly app `turnpike-qie` and its volume (kept as a fallback; deletion is irreversible).
- [ ] Payment deadline default of 60 s and retention of 30 days.

## Changes worth reviewing in diff form
`git log --oneline a984f86..HEAD` lists each step. Suggested reading order: `packages/middleware/src/index.ts` and `store.ts` (lifecycle), `packages/client/src/client.ts` (agent safety), `packages/cli/src/cli.ts`, then the tests beside each.

## Owner's own work and review (to be written by the owner)
Prompts for this table are in `docs/submission/OWNER_TASKS.md` section C. Write only what you did yourself.
| Date | What I did myself (code, review, decision, testing) | Commit or file |
|---|---|---|
| | | |
