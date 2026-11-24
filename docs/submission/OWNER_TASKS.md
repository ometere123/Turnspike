# Work only the owner can do (prompts and checklists)

**Short list to submit:** (1) review the code and write your own entries in `docs/HUMAN_REVIEW_LOG.md`; (2) done: the site was released on 24 November 2026; (3) sign `FOUNDER_DECISIONS.md` and pick the track; (4) watch, approve and upload the video; (5) be ready to present (`presentation/`); (6) confirm eligibility and submit the form. Everything else in this file supports those six. An external developer trial and seller-experience work are deferred and block nothing.

Nothing here is ticked or filled in. Each item is something that must be genuinely done by the project owner before it can be claimed. Deadline: **30 November 2026, 23:59 CET**. Leave a day of margin.

## A. Review the code yourself (feeds `docs/HUMAN_REVIEW_LOG.md`)
Pick at least these and write what you saw, in your own words, in the log's owner table.
- [ ] Run `npx hardhat test` and read `contracts/TurnpikeAllowance.sol` `pay()`. Prompt: "In what order does `pay()` check its rules, and what happens to the QUSDC if any check fails?"
- [ ] Run `npx vitest run packages/middleware`. Prompt: "Why must the `sig` be presented with every redemption, and what would go wrong without it?"
- [ ] Run `npx vitest run packages/client`. Prompt: "What does the client do when a payment's outcome is unknown, and why does it not mark it failed?"
- [ ] Run `node examples/end-to-end/run.mjs` (local chain, test token). Prompt: "Which steps happened, and which of them would cost real money on mainnet?"
- [ ] Open the mainnet transaction `0x7e41ccaa…21b7` on https://mainnet.qie.digital and the contract's verified source. Prompt: "Who is the owner, agent and merchant, and what do the event fields say?"
- [ ] Answer, without notes, the six questions at the end of `OWNER_REVIEW_CHECKLIST.md`.

### A contribution you can genuinely make before the deadline
The rules judge developer contribution, and nobody can write that for you. Small, real pieces of work that need your judgement:
- [ ] Try `/app` with QIE Wallet or MetaMask on the preview without sending anything, then write down what was confusing and change that wording yourself in `apps/web/src/components/app/app-console.tsx`.
- [ ] Choose the confirmation count you are comfortable with and explain why, next to `SETTLED_CONFIRMATIONS` in `apps/web/src/lib/receipt-inspector.ts`.
- [ ] Add one test of your own to `apps/web-e2e/tests/` for something you would not want to break.
- [ ] Read the correlation rules in `apps/web/src/lib/delivery.ts` and the restore test `TEST-BAK-1`, and write in the log whether you agree with each rule.
Prompts for explaining the code to judges: why are settlement and delivery separate; what happens if the wallet disconnects after sending; what does a restored backup not know?

## B. Decisions to adopt (sign in the files, not here)
- [ ] Decide D2 again in light of the coverage-instrumented deployment (`docs/OWNER_DECISIONS.md` D2): keep and disclose, or redeploy a clean build. Evidence: `evidence/M9_deployed_bytecode_verification.md` (optionally rerun its section E yourself and log it).
- [ ] `docs/submission/FOUNDER_DECISIONS.md`: edit, then sign the adoption block.
- [ ] `docs/DIFFERENTIATION.md`: read the listed sources, then tick PASS or FAIL and write your reasoning.
- [ ] `docs/OWNER_DECISIONS.md`: confirm each proposed decision matches what you adopted.

## C. Contribution log (`docs/HUMAN_REVIEW_LOG.md`)
Write only what you did yourself. Prompts:
- "Which product and scope decisions did I make, and when?" (for example the specification, the track, the brand, keeping the contract)
- "Which accounts, wallets and funds did I provide, and which releases did I approve or perform?" (for example the npm org, the passkey approvals, the CLI 0.1.1 publish from my PC on 2026-11-19, if that is what happened)
- "Which reviews and test runs did I perform myself in section A, and what did I find?"
- "What did I change or reject after reviewing?"

## D. Videos (`docs/submission/video/`)
- [ ] Watch `TurnspikeHackathonDemo.mp4` and `TurnspikeLaunchTrailer.mp4` in full (paths in `video/README.md`). Check every number and hash against `evidence/`.
- [ ] Decide whether to replace the animatic segments with your own screen recordings (list in `video/RECORDINGS_NEEDED.md`). Recording them needs no new payment: the transactions already exist.
- [ ] Record the narration in your own voice from `video/NARRATION.md`, or approve the caption-only version.
- [ ] Upload the approved video yourself and paste the link into the form.

## E. Eligibility and the form (only you can confirm these)
- [ ] Re-read the official terms and the submission form on hackathon.qie.digital; note the date you read them.
- [ ] Confirm each eligibility requirement the terms list (for example age, a QIE wallet, not being a QIE affiliate, a verified email). Do not confirm anything you have not checked.
- [ ] One submission per team.
- [ ] Paste `docs/submission/APPLICATION.md` after editing it; select the track; enter the contract address, repository and live URL.
- [ ] Submit.

## F. Before you submit, check live
- [ ] https://turnspike-qie.vercel.app loads in a clean browser window; the home page shows a live 402.
- [ ] `npx @turnspike-qie/cli@0.1.1 network status` reads mainnet.
- [ ] `curl -i https://turnspike-qie.fly.dev/v1/block-summary` returns 402.
- [ ] https://turnspike-qie.vercel.app/operations works in your own browser.

## G. Deferred, stated as such
- External developer test: deferred. Do not claim adoption.
- Legacy Fly app `turnpike-qie`: keep until after judging.
- Demo agent key rotation: after judging.
