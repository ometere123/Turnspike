# Founder submission preflight — 26 November 2026

**Prepared by an AI project assistant, for the founder's review. Not a signature, personal declaration or submission.** This is meant to reduce the founder's work to checking the facts and taking the actions requiring their own identity or authorization.

## Verified from the repository (as of this review)

- PR #16 was merged into `main` at `2ee3ec0bc1589f85715b6ce7313dd552b316732e`; it changed only `docs/CHANGELOG.md` and `docs/RELEASE_CANDIDATE.md`. No new Vercel deployment is required **for those documentation changes alone**.
- There were no open pull requests at the moment checked.
- `evidence/M11_owner_cycle_2026-11-24.md` documents the owner operating a real browser wallet on QIE Mainnet and a project-operated CLI purchase, followed by revoke and withdrawal. It is not proof of outside adoption or of the owner's source-code authorship.
- Current docs describe the local MCP as payable **only with owner-enabled payments and a trusted host asking for a confirmation**, while hosted MCP is read-only. No mainnet MCP payment is documented.
- `docs/submission/video/README.md` identifies the intended 89-second upload as `TurnspikeLiveDemo-v2.mp4`, with SHA-256 `6c58c6ed31f8d87d9cf50490f9a387f88f383c456eb4c3b6cabdbe39ad48b599`. The file is reportedly on the original working computer, not stored in Git. This reviewer did not open or watch it.
- `docs/submission/APPLICATION.md` contains the mainnet address, public URLs, track proposal and disclosure. The actual submission form and account-specific eligibility must be verified by the founder.
- Cloudflare is a payment-disabled standby in the reviewed docs; the normal paid gateway is Fly. Billing status was not accessible here.

## Prepared decisions and recommended wording — founder must adopt or edit

**Track — recommend AI + Autonomous Agents.** The most defensible story is an agent buying a paid API autonomously while the owner posts on-chain caps, allowlists and revoke/pause controls.

**Differentiation — recommend PASS on the combined integration only, not novelty of the individual controls.** The supporting reasoning is in `docs/DIFFERENTIATION.md` and `docs/AI_TECHNICAL_REVIEW_2026-11-26.md`. SpendGrid remains unverified; no claim of "first", "audited" or x402 compatibility.

**Contract — recommend keep the current deployed contract and disclose its limitations.** The bytecode is a coverage-instrumented build, not the optimized source build; the contract is unaudited. Redeploying would require fresh approvals and new evidence. No redeployment is authorized by this memo.

**Release — maintain an honest status.** Avoid representing Cloudflare standby as the live payment backend or CI success as an independent audit. Do not change payment infrastructure without a state-preserving, owner-authorized cutover.

**Founder contribution — confirmation-ready evidence, not a completed personal attestation.** The M11 record and the seven owner-action drafts in `docs/HUMAN_REVIEW_LOG.md` may be used where accurately confirmed. The AI has read the Solidity `pay()` and MCP payer for the technical report; that review belongs to the AI, **not** in the table of actions performed personally by the founder. The contest warns against overwhelmingly AI-generated projects with minimal human developer contribution. Honest disclosure and real founder technical work matter.

## Minimum outstanding founder-only actions

1. **Personal technical review and contribution record:** Read the highlighted `pay()` and MCP review, check the source yourself, and record what you genuinely understood, challenged, tested or changed in `docs/HUMAN_REVIEW_LOG.md`. No one should invent founder authorship or copy AI findings into a table headed "what I did myself" as if they were the founder's work.
2. **Differentiation decision:** Decide PASS or FAIL and add your reasoning in `docs/DIFFERENTIATION.md`; the AI recommends PASS on the combined solution only.
3. **Founder attestation:** Verify and sign the end of `docs/submission/FOUNDER_DECISIONS.md`, ticking only statements actually true.
4. **Identity and eligibility:** Confirm the Team paragraph and personal contact details in `docs/submission/APPLICATION.md`. Confirm the current official rules and your actual eligibility yourself. AI cannot know your age, employment affiliation or declarations.
5. **Gateway availability:** Inspect Fly billing/payment status because the live gateway may depend on it. If paid service is unavailable, do **not** misrepresent a disabled Cloudflare standby as an operational replacement.
6. **Video:** Retrieve and watch the exact 89-second file, confirm its SHA-256, decide to approve it and upload through an authenticated account. The current reviewer has not seen or uploaded the video.
7. **Submit:** Review the final application and submit it at `hackathon.qie.digital` by the repo-documented deadline of **30 November 2026, 23:59 CET**, subject to a fresh check of the official form.

## Six judge questions and concise technical study answers

- **Why is the 402 signature private?** The transaction hash is public. The server-issued HMAC signature is a bearer component needed to redeem the purchased resource; revealing it unnecessarily can disclose the response.
- **If the seller crashes after payment?** Known paid requests can be reconciled and their handler re-run; if a response was stored before the crash, the same proof can replay it. A completely lost, unbacked-up challenge/secret may be unrecoverable and does not guarantee a refund.
- **Why can a daily cap allow nearly double within a short period?** The accounting resets on UTC day boundaries, not on a rolling 24-hour interval. Balance and per-call restrictions still apply.
- **Why no refund for an undelivered payment?** The deployed contract transfers value in `pay()`; it has no escrow or automatic reversal. This is a disclosed risk, not a resolved product feature.
- **What can the QUSDC issuer do?** The repo discloses role-based mint/burn privileges; issuer trust is separate from Turnspike's account limits.
- **Why isn't it x402-compatible?** The live protocol is `turnspike/1`, with a custom on-chain allowance payment. The experimental x402 branch did not deliver standard interoperable `exact` settlement on QIE/QUSDC and was closed unmerged.

**These answers are study notes, not evidence the founder has personally answered them.**

## This assistant's actual actions

On this branch the assistant inspected GitHub source and documents, wrote `docs/AI_TECHNICAL_REVIEW_2026-11-26.md`, and prepared this preflight. It did not run local tests, audit the exact deployed runtime, sign transactions, view private billing, watch the uncommitted video, or complete a real submission.
