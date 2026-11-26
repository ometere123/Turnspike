# Human review and contribution log

The hackathon requires genuine developer contribution and disallows predominantly AI-generated work (HR-008, process rule PR-2). This file is for the project owner to keep honest, first-person records. The assistant cannot fill it in on the owner's behalf, and nothing here should be read as a claim that a review happened unless the owner has recorded it.

## AI assistance disclosure (accurate as of 2026-11-24)
An AI coding assistant wrote the first version of: the Solidity contract and its tests, the middleware, the gateway, the demo agent, the client SDK, the CLI, the examples, both frontends, the CI, the deployment configuration and most documentation edits made since the specification. The owner supplied the specification, approved scope, funded the demo wallets, and pointed the assistant at the deployment accounts. The Stage 4 proof-of-mechanism contract and its mainnet run predate this build. The Cloudflare gateway, the browser tests, the slides, the video recording and these submission drafts were also made by the assistant, and the independent review in `RELEASE_QA.md` was done by another AI agent.

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
Write only what you did yourself.
| Date | What I did myself (code, review, decision, testing) | Commit or file |
|---|---|---|
| | | |

### Draft entries for the owner to confirm (prepared by the AI assistant, 2026-11-24)
**These are not the owner's entries yet.** Each line is drawn from the chain, the npm registry or the owner's messages to the assistant. The owner keeps only the lines that are true, in their own words, and moves them into the table above. They describe wallet operation, decisions and approvals; none of them is a claim to have written or reviewed code.

| Date | Draft | Where it can be checked | Owner confirms |
|---|---|---|---|
| 2026-11-24 | I connected my own browser wallet to the live console and signed, myself: pause, unpause, approve exactly 0.002 QUSDC, deposit, allow merchant, set policy, revoke, withdraw all. | `evidence/M11_owner_cycle_2026-11-24.md`, nine hashes | [ ] |
| 2026-11-24 | I created a new agent key on my PC with a password only I know, funded it, and ran `turnspike api pay` against the live gateway. The first try stopped with `rpc_unavailable` and sent nothing; the second paid 0.001 QUSDC. | M11; agent `0x8429ACBB9000Ff6a34fC5c452A73961C29B52867` | [ ] |
| 2026-11-24 | While using the console I saw that the history kept offering "Try again", and reported it. The cause was a block-range limit on QIE's RPC; it was fixed in PR #10. | PR #10 | [ ] |
| 2026-11-24 | I decided to stay on Fly and keep Cloudflare as a standby with payments off. | `OWNER_DECISIONS.md` D11 | [ ] |
| 2026-11-24 | I approved, one by one: merging PRs #8 to #12, each production deployment, one 0.001 QUSDC demo purchase, copying the Fly database, and correcting the gateway's own-address list. | GitHub; `evidence/M10_live_purchase_2026-11-24.md` | [ ] |
| 2026-11-19 | I approved the npm publications with my passkey and published the CLI 0.1.1 from my PC. | npm registry | [ ] |
| before 2026-11-19 | I supplied the product specification, chose the brand and the scope, and funded the demo wallets. | the disclosure above | [ ] |

Still needed for the rules on developer contribution, and only the owner can do it: read and explain `pay()` in `contracts/TurnpikeAllowance.sol`, run the tests once, and answer the six questions in `OWNER_REVIEW_CHECKLIST.md`.
