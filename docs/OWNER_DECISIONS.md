# Owner decision register

Prepared 2026-11-19 from a fresh review. **Update, 2026-11-19:** the owner has proposed a choice for every entry (summarised in each section as "Owner's proposal" and written out in `docs/submission/FOUNDER_DECISIONS.md`). Proposals are not adoptions: the owner adopts them by signing that file. Each entry also keeps the original recommendation. Flags: **$** money, **K** keys or secrets, **P** public publishing, **I** irreversible.

| ID | Decision | Flags |
|---|---|---|
| D1 | Differentiation PASS or FAIL | P |
| D2 | Keep the deployed contract; no redeploy for branding | $ I |
| D3 | Turnspike branding except compatibility identifiers | |
| D4 | npm publishing and versions | P I |
| D5 | Hackathon track | P |
| D6 | Mainnet spend | $ |
| D7 | Key custody | K |
| D8 | Legacy Fly infrastructure | I |
| D9 | Protocol changes (deadline, retention, compatibility) | $ I |
| D10 | Video, submission form, disclosure wording | P |

## D1 Differentiation PASS / FAIL
- **Recommendation: PASS on the combination claim only** (contract-enforced owner limits, request-bound verification, durable delivery and recovery, SDK/CLI/console on one protocol), after you read the sources in `docs/DIFFERENTIATION.md` yourself. The checkbox stays unticked.
- Alternatives: FAIL and reposition as reliability tooling; or hold until SpendGrid's source or contract is found.
- Risks: SpendGrid (QIE Hackathon 2) is unverified, so a judge may say "this exists". Each ingredient is known; do not drift to "first". Adoption is zero.
- Approve: your reading of the sources, the final positioning sentence, and ticking the box.
- **Owner's proposal:** PASS on the integrated solution only; no claims of invention, firstness, x402 compatibility or audit; unverified competitors stay "unknown". Box still unticked.

## D2 Keep the deployed `TurnpikeAllowance` (0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c)
- **Recommendation: keep.** The name is cosmetic; the contract has no admin and a 5 QUSDC per-account deposit cap. A redeploy would strand deposits, break evidence links and add new unaudited bytecode days before the deadline.
- Alternative: redeploy as `TurnspikeAllowance` and migrate (gas, re-verification, all evidence references change).
- Risk of keeping: the name mismatch is visible on the explorer; the README explains it.
- Approve: "no redeploy". A redeploy is **$ I** and is not part of this work.
- **Owner's proposal:** keep; no redeploy, no bytecode change.
- **New fact for this decision:** **Deployed bytecode is a coverage-instrumented build (found 2026-11-19).** The bytecode at `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` is 9,610 bytes; a clean optimised compile of `contracts/TurnpikeAllowance.sol` is 3,570 bytes, and the source verified on the explorer contains solidity-coverage probes (functions such as `c_480caa1b` and "modifier-pre/post" markers). The verified deployed source contains coverage instrumentation, and behavioural equivalence of the deployed runtime to the clean build has not been fully established. The 15 contract tests, the Slither analysis and the test gas figures ran against the clean build, so they do not directly validate the exact deployed bytecode. The real mainnet transactions in `evidence/` demonstrate specific behaviours of the deployed contract: an allowed payment, rejections with CapExceeded and RequestAlreadyUsed, and an owner revoke followed by a refused agent payment. Likely cause: the deploy reused artifacts left by `hardhat coverage`. Whether to redeploy a clean build is an owner decision (D2); nothing was redeployed. Options: keep and disclose (current text everywhere), or redeploy a clean build before the deadline (gas, re-verification, new address in every document, evidence links change; flags $ I).

## D3 Branding
- **Recommendation:** keep the current state. Turnspike in product copy. `TurnpikeAllowance`, the `turnpike` export alias, the `TURNPIKE_LOG` fallback and `evidence/` stay as documented compatibility or historical names.
- Risk: a grep finds "Turnpike" leftovers; each is deliberate.
- Approve: that this explanation is acceptable.
- **Owner's proposal:** Turnspike publicly; historical and compatibility names kept.

## D4 npm publishing
- **Done, 2026-11-19:** `@turnspike-qie/client@0.1.1` and `@turnspike-qie/cli@0.1.1` are published (owner's passkey; the CLI was published by the owner from their PC) and verified from clean registry installs; middleware stays at 0.1.0. The rest of this section is the earlier analysis.
- Earlier: verified with `npm view` on 2026-11-19: `@turnspike-qie/client`, `@turnspike-qie/middleware` and `@turnspike-qie/cli` were published at **0.1.0**. A clean `npm i` of all three in an empty directory worked, `turnspike --help` runs, and `require` of client and middleware loads. The `@turnspike` scope belongs to another account.
- **The published client 0.1.0 predates this review's fix** (resuming a never-paid, expired challenge no longer pays it). **Recommendation: publish client 0.1.1** after merging this branch and re-running all tests. Middleware and CLI are unchanged by this review. This branch changes no package versions.
- Alternative: leave 0.1.0. The bug needs a crash between challenge and payment plus a resume after expiry, and costs one wasted micro-payment.
- Flags **P I**: a published version is effectively permanent. Publish only with your 2FA after the final test run.

## D5 Track
- Live tracks (hackathon.qie.digital, fetched 2026-11-19): DeFi & Financial Infrastructure; AI + Autonomous Agents; Consumer Apps & Social; Commerce & Real World; Developer Infrastructure & Tooling.
- **Recommendation: AI + Autonomous Agents.** The headline story is an autonomous agent under an owner-enforced budget, with SDK, CLI and a live mainnet agent purchase.
- Alternative: **Developer Infrastructure & Tooling**: the shipped product is middleware, SDK and CLI. Choose it if you judge the agent framing to look like a wrapper, or if you can credibly argue developer adoption.
- Risk: judging criteria include QIE ecosystem integration and user adoption potential. We use QIE mainnet and QUSDC only (no QIE Wallet, QIE ID, QIEDEX or oracle). State that plainly.
- Approve: the track selected in the form.
- **Owner's proposal:** AI + Autonomous Agents.

## D6 Mainnet spend
- **Recommendation:** none beyond, at most, one fresh recorded purchase if the video needs it. Existing `evidence/` transactions (M4, M5, M7, M8) are real and sufficient for the fallback. The public demo is capped by proof of work, quotas and a daily transaction budget.
- Cost per paid call: 0.001 QUSDC plus about 0.0001 QIE gas (evidence/M8).
- Approve: any top-up of demo wallets. This work spent nothing.
- **Owner's proposal:** no new mainnet payments, funding, secret changes or irreversible actions; the video uses existing evidence.

## D7 Key custody
- Demo agent key: Fly secret. SDK and CLI: encrypted keystore. Owner key: never on a server.
- **Recommendation:** keep the demo agent balance small, rotate the key after judging, never reuse it. Use a KMS or remote signer for real deployments (the SDK accepts any ethers Signer).
- Risk: if the Fly secret leaks, loss is bounded by the demo agent's balance and the owner's on-chain caps.
- Approve: rotation timing and who holds backups.

## D8 Legacy Fly app `turnpike-qie`
- Stopped and kept. **Recommendation: keep until after judging (10 Dec), then delete.**
- Deletion is **I** (volume lost). Keeping leaves stale secrets on a stopped app. Not touched by this work.

## D9 Protocol changes
- Current: payment deadline 60 s after expiry, retention 30 days, `turnspike/1`, not x402-compatible.
- **Recommendation: freeze for submission.** Later: per-owner replay key and an x402 adapter (contract change, **$ I**).
- Risk of changing now: invalidates tests, evidence and the published packages.
- **Owner's proposal:** `turnspike/1` frozen; no new features; no x402 claim.

## D10 Public statements
- Video, submission form entry and AI-assistance disclosure wording are yours. The hackathon page lists "AI-Generated Projects" (minimal developer contribution) as zero tolerance and does not state whether AI assistance is allowed; its FAQ answer was not retrievable.
- **Recommendation:** keep the accurate disclosure in `docs/HUMAN_REVIEW_LOG.md` and do real, recorded work yourself (review, run the flows, record the video, edit the docs) so the log is true.
- **Owner's proposal:** an evidence-led demo and a short trailer from real UI and existing transactions; external developer testing deferred and stated as not demonstrated; final attestations left to the owner (`docs/submission/OWNER_TASKS.md`).
