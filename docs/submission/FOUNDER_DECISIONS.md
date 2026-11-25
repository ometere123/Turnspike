# Founder decisions for the QIE Hackathon 3.0 submission (draft in the owner's voice)

**Status: DRAFT, not adopted.** This text was prepared by an AI assistant from the decisions I (the project owner) proposed on 2026-11-19 and the approvals I gave in chat on 2026-11-24. It becomes my decision only when I have re-read it, edited anything I do not agree with, and signed the adoption block at the end. Nothing below records personal testing, code contributions, eligibility or approval that I have not yet done; those are in the attestation block, unticked.

## 1. Track: AI + Autonomous Agents
I am entering Turnspike in **AI + Autonomous Agents**. The story I want judges to see is an autonomous agent paying for an API on its own, while I, the person who funds it, keep limits it cannot get around: a per-call cap, a daily cap, a merchant allowlist, a pause switch and revocation, all checked by the settlement contract inside the payment itself. The middleware, SDK and CLI are how that works in practice; they are the means, not the headline.

## 2. Differentiation: PASS on the integrated solution (proposed)
My proposed decision is **PASS**, on the integrated solution only:
- owner spending limits enforced by the settlement contract on QIE Mainnet;
- signed, expiring HTTP 402 challenges bound to one resource (method, path, sorted query; optionally body and caller);
- paid delivery that survives crashes and outages (response stored before it is sent, fenced delivery lease, chain reconciliation, a restart-safe agent journal);
- one protocol behind a seller middleware, an agent SDK, a CLI and a web console.

I do not claim that Turnspike invented any of those components, that it is the first, that it is x402-compatible, or that it has been externally audited. Where I could not verify a competing project's functionality (for example SpendGrid from QIE Hackathon 2), it stays marked **unknown** in `docs/DIFFERENTIATION.md`. The PASS box there stays unticked until I have read the sources myself.

## 3. Contract: keep the deployed `TurnpikeAllowance`
I am keeping the contract already deployed and verified on QIE Mainnet at `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c`. I will not redeploy it for branding or change its bytecode before the deadline. Its name predates the rename; the README explains this.

## 4. Brand: Turnspike
Turnspike is the public name. Historical and on-chain names stay where compatibility or the record needs them: the contract name `TurnpikeAllowance`, the deprecated `turnpike` export alias and `TURNPIKE_LOG` fallback in the middleware, and file names and URLs inside `evidence/`.

## 5. Packages
`@turnspike-qie/middleware` is at **0.1.1** (README only; same code as 0.1.0). `@turnspike-qie/mcp` is at **0.1.0**. `@turnspike-qie/client` and `@turnspike-qie/cli` are published at **0.1.1**, with the payment-safety fixes from PR #2. Registry links:
- https://www.npmjs.com/package/@turnspike-qie/middleware/v/0.1.1
- https://www.npmjs.com/package/@turnspike-qie/client/v/0.1.1
- https://www.npmjs.com/package/@turnspike-qie/cli/v/0.1.1

## 6. Spending and security
On 24 November 2026 I approved one demo purchase (0.001 QUSDC, `evidence/M10_live_purchase_2026-11-24.md`) and I ran one owner cycle from my own wallet (`evidence/M11_owner_cycle_2026-11-24.md`, 0.001 QUSDC paid). No further mainnet payment, secret change, infrastructure deletion or irreversible step is made for the submission without my approval of that exact step. The stopped legacy Fly app `turnpike-qie` stays until after judging.

## 7. Protocol frozen
`turnspike/1` is frozen for the submission: payment deadline 60 s after challenge expiry on chain time, 30-day retention of unpaid challenges, no protocol features. The MCP server (25 November 2026) is a separate tool and changes neither the protocol nor the contract. I make no x402 compatibility claim.

## 8. External users
External developer testing is deferred. Independent adoption has **not** been demonstrated: the gateway counts 7 delivered calls, 7 from project-operated wallets and 0 external (24 November 2026).

## 9. Video and slides
One video: `TurnspikeLiveDemo-v2.mp4`, 89 seconds, the live site on QIE Mainnet, unedited except for cuts, no captions and no voice (`video/README.md`). The older animatic and trailer are not submitted. The slides are `presentation/Turnspike-presentation.pptx` (10 slides, also PDF).

## 9b. Hosting for judging
Fly serves the live gateway until judging ends. Cloudflare is a standby with payments off (`docs/OWNER_DECISIONS.md` D11).

## 10. Final approval stays with me
This draft may be written in my voice, but it does not invent my personal testing, my code contributions, my eligibility declarations or my signature. Those are below, for me to verify and complete.

## Adoption and attestations (to be completed by the owner only)
- [ ] I have read this document and edited it where it did not match my view.
- [ ] I have read the sources in `docs/DIFFERENTIATION.md` and I record PASS or FAIL there in my own words.
- [ ] I have personally run the checks I list in `docs/HUMAN_REVIEW_LOG.md`, and every entry there is true.
- [ ] My eligibility items for QIE Hackathon 3.0 are true (as stated on the official terms page I re-read on: __________).
- [ ] I have watched the video in full and approve it for upload.
- [ ] I approve submitting the application text in `docs/submission/APPLICATION.md` as edited by me.

Adopted by: ______________________   Date: ____________
