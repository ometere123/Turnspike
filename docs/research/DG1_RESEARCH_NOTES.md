# DG-1 Research Notes (research input, NOT the owner's decision)

Status: research input only. This file gathers facts for the owner, who must author `docs/DIFFERENTIATION.md` and decide PASS or FAIL. It does not pick either.
Researched: 2026-11-19. Method: web search plus page fetches. Search snippets are secondary; only pages actually fetched and read count as primary.

Labels: VERIFIED = read in a primary source by the researcher. REPORTED = seen only via a secondary source or a search-result summary. UNVERIFIED = not found / not retrievable.

## 1. Sources (accessed 2026-11-19)

| # | Source | URL | Retrieved? |
|---|---|---|---|
| S1 | CryptoSlate press-release syndication, QIE Hackathon 2 conclusion (22 Jul 2026 per search result) | https://cryptoslate.com/press-releases/qie-blockchain-hackathon-2-concludes-with-record-participation-as-hackathon-3-launches-on-1-august/ | NO. HTTP 403 on fetch (also on `?p=549623`). Content known only from search-result summaries. |
| S2 | Chainwire copy of same release | https://chainwire.org/2026/07/22/qie-blockchain-hackathon-2-concludes-with-record-participation-as-hackathon-3-launches-on-1-august | NO. HTTP 404 on fetch. Appeared in search results only. |
| S3 | x402 reference repo (Coinbase) | https://github.com/coinbase/x402 | Yes |
| S4 | Coinbase CDP x402 facilitator docs | https://docs.cdp.coinbase.com/x402/seller/facilitator.md | Yes |
| S5 | arXiv 2605.11781 "Five Attacks on x402 Agentic Payment Protocol" (Li, Wang, Wang; submitted 12 May 2026) | https://arxiv.org/abs/2605.11781 and https://arxiv.org/html/2605.11781v1 | Abstract yes; HTML read for first ~100k of ~139k characters |
| S6 | Coinbase Agentic Wallet CLI docs | https://docs.cdp.coinbase.com/agentic-wallet/cli/welcome | Yes |
| S7 | Coinbase Agentic Wallets launch page (11 Feb 2026 per search result) | https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets | NO. HTTP 403. Search-result summary only. |
| S8 | Safe docs, modules | https://docs.safe.global/advanced/smart-account-modules | Yes |
| S9 | Zodiac docs | https://docs.zodiac.wiki/ | NO. DNS failure. |
| S10 | HackerEarth QIE hackathon page | https://qie-blockchain-hackathon.hackerearth.com/ | NO (search result only; unclear which edition) |
| S11 | Search for SpendGrid repo | several web searches | No repository found |

## 2. Findings per subject

### 2a. SpendGrid (QIE Hackathon 2)
- REPORTED (S1/S2 via search summaries, not read directly): placed 4th in QIE Hackathon 2; builder named Estar Kunmi; described as a "payment-intent execution layer that lets treasuries, DAOs and AI agents enforce spending policies before transactions reach the blockchain"; intents are checked against budget rules, identity requirements, liquidity checks and permission controls.
- The wording "before transactions reach the blockchain" suggests pre-submission (off-chain) policy checking. This is an inference from marketing text, not a verified fact.
- UNVERIFIED: whether limits are enforced on-chain or off-chain. No public repo, docs or contract address found in any search. Not established that code is public at all.
- Name collision: search also returned unrelated products named Spendgrid (SaaS-spend tool at spendgrid.app, an expense tracker repo). These are not the QIE project; not fetched.
- Action for owner: obtain the press release text directly (S1/S2 blocked from this tool), and check QIE's hackathon site/Telegram for a SpendGrid submission link.

### 2b. QIE Hackathon 2 retrospective
- REPORTED (search summaries): organiser press release dated about 22 Jul 2026 states 2,300+ developers, 411 dApp submissions, top five: 1 Qantara, 2 VeridiChain (Daanu Labs), 3 Fluenci (MrNetwork), 4 SpendGrid (Estar Kunmi), 5 RemitChain (Chain Labs); Hackathon 3 opens 1 Aug; emphasis on shipping to mainnet.
- UNVERIFIED: no dedicated organiser retrospective (lessons, judging notes) was found. The press release is promotional, not a retrospective. Primary page could not be read.
- A HackerEarth page lists YesNo Markets, Enoobs, NeuroCred as winners with dates Oct 2025 to Jan 2026; edition unclear, likely a different (earlier) event. UNVERIFIED relevance.

### 2c. x402
- VERIFIED (S3): open HTTP-based payment standard; client gets 402 with payment options, sends signed payment, server verifies (locally or via facilitator `/verify`), settles (own chain interaction or facilitator `/settle`), then returns the resource with 200 and a `PAYMENT-RESPONSE` header. Schemes: `exact`, `upto` ("authorizes up to a maximum per request"), `batch-settlement` (EVM only). The README text as summarised does not address replay protection, idempotency or spending limits. It says schemes must not let facilitator or server move funds beyond client intent.
- VERIFIED (S4): Coinbase CDP facilitator supports Base, Polygon, Arbitrum, Monad, World, Solana (and testnets). QIE not listed. Page makes no statement on replay, idempotency, delivery.
- VERIFIED (S5, partly read): academic analysis (testbed, Base Sepolia, a few live testnet endpoints; not mainnet frequency data). Chain enforces one settlement per nonce, but HTTP layer can grant the resource repeatedly. Replaying one payment 50 times gave 50 grants in the testbed; 1,000 concurrent replays of one header gave 248 HTTP grants and 1 settlement on a live endpoint. Three audited SDKs: payment-ID idempotency missing (except one Rust SDK in pessimistic mode); resource-ID binding missing in all three; no automatic Cache-Control no-store. Some SDKs flush the response before settlement, so paid-but-undelivered and delivered-but-unsettled outcomes occur. Proposed mitigations include atomic claim of payment ID plus resource ID, resource binding in the signed payload, and two-phase reserve-then-settle. The last ~39k characters of the HTML (possibly including crash/recovery discussion) were not read.
- Seller-side crash recovery / exactly-once delivery: NOT addressed in S3/S4; S5 describes the problem class and mitigations, not a shipped product.
- UNVERIFIED: any QIE x402 facilitator. Search found none; absence of evidence only.
- Note: x402 is a protocol; Turnpike's PRD lists an x402 interoperability layer as a non-goal.

### 2d. Other agent-wallet products with spending limits
1. Coinbase Agentic Wallets / agentic-wallet CLI.
   - VERIFIED (S6): saved limit required before autonomous spending; rolling 24-hour USD budget; reservations of budget for pending operations (uncertain outcomes keep the hold); optional next-transaction-only limit; counts sends, approvals, swap inputs and x402 payments; each wallet has its own address; delegated signing by CDP; key not stored by the wallet MCP. Enforcement location (TEE, server or on-chain) is stated as unspecified; "signing authorization is checked again at execution". Autonomous actions on Base (Base Sepolia when enabled); x402 payments vary by scheme.
   - REPORTED (S7 via search summary): launched 11 Feb 2026, non-custodial in TEEs, session caps and per-transaction limits.
   - Reading: limits appear to be policy-layer controls, not shown to be inside a settlement contract. This is an inference; enforcement location is not documented in what was read.
2. Safe smart accounts + modules.
   - VERIFIED (S8): modules extend a Safe; owners enable/disable modules via threshold approval; modules can execute arbitrary transactions; "daily spending allowances" is listed as an example module function. The page does not name a specific allowance module or its contract details. Owners can always change module set, so there is a privileged owner configuration path.
3. Zodiac Roles (permissioned delegation on Safe): UNVERIFIED. Docs could not be fetched; no claim made.
4. Open-source hackathon projects on NEAR surfaced by search (spendguard variants, Bound "on-chain spending-policy treasury for AI agents", IntentGuard "policy-gated payment rail ... per-transaction and daily caps", PGAP "smart contracts enforce the rules on-chain"). REPORTED only (search summaries, repos not read). They indicate on-chain agent spending policy is not a unique idea. Examples: https://github.com/aoyamari/Bound, https://github.com/tim963852741/intentguard, https://lablab.ai/ai-hackathons/agentic-commerce-on-arc/policy-governed-agents/policy-governed-agent-payments-pgap

## 3. Comparison against Turnpike candidates

| Competitor | D1 limits inside settlement contract | D2 seller-side drop-in, server HMAC request IDs, single-use on-chain consumption, idempotent delivery, crash recovery | D3 no admin/upgrade key |
|---|---|---|---|
| SpendGrid | UNVERIFIED. Description says checks occur "before transactions reach the blockchain" (REPORTED), which points to off-chain, but no code seen | UNVERIFIED. Description is buyer/treasury side; no seller middleware mentioned | UNVERIFIED (no contract or repo found) |
| x402 (protocol + CDP facilitator) | Not addressed in S3/S4; `upto` caps a single request only (VERIFIED). Per-authorization limits are signed by payer, not a standing account policy | Seller-side verify/settle flow exists (VERIFIED). Idempotency, replay guard and crash recovery are not specified; S5 shows SDKs lacking them (VERIFIED for audited SDKs, as of paper) | Not applicable to the protocol; facilitators are operated services (not examined) |
| Coinbase Agentic Wallets | Limits exist (VERIFIED) but enforcement location unspecified; not shown to be in a settlement contract | Buyer-side wallet; seller delivery not covered | Hosted CDP signing service; a platform operator exists (VERIFIED: CDP performs delegated signing) |
| Safe + modules | Allowance-style modules exist as a pattern (example only on S8); detail not read | Not a seller product | Owners/threshold can change modules (VERIFIED) |
| NEAR hackathon projects | REPORTED: some claim on-chain policy enforcement | Not examined | Not examined |

Evidence summary per candidate (no verdict):
- D1: supported if SpendGrid and the hosted wallets are off-chain/unspecified, which is only partly evidenced; contradicted as a unique idea by REPORTED on-chain policy projects and the Safe module pattern. SpendGrid's on-chain/off-chain status remains UNVERIFIED.
- D2: supported by S5, which documents that the audited x402 SDKs lack payment-ID idempotency and resource binding, and that delivery-vs-settlement ordering is a real gap. No found product was shown to ship the specific combination (HMAC request IDs, single-use consumption, crash recovery). Absence of such a product is not proven; only a limited search was done. Mitigations in S5 are published, so the ideas are not novel in the abstract.
- D3: verifiable from Turnpike's own source only. Competitors examined: hosted wallet has an operator; Safe owners can alter modules. SpendGrid unknown.

## 4. Where Turnpike is NOT different (honest list)
- Agent spending limits as a concept are not new: Coinbase Agentic Wallets (VERIFIED), Safe allowance-style modules (REPORTED/partial), and multiple hackathon projects (REPORTED) already offer caps and budgets.
- Per-request payment over HTTP 402 is x402's model; Turnpike is not inventing the payment flow.
- Single-use payment consumption keyed to a nonce is what x402's EIP-3009/Permit2 nonces already give on-chain (S5: "chain enforces one settlement per nonce"). The novelty claim must be the seller-side HTTP-layer guarantees, not the on-chain nonce itself.
- Reservation of budget before signing exists in Coinbase's agent CLI (VERIFIED), so reserve-then-settle thinking is not unique.
- Replay/idempotency/binding mitigations are published in S5; Turnpike would implement known mitigations.
- "Cheap/fast on QIE" is not a differentiator (already excluded in the PRD). No QIE x402 facilitator was found, but that is absence of evidence, and x402 interop is a stated non-goal.
- D3 is a property of Turnpike's own contract, not a feature a buyer sees; it reduces trust assumptions but does not by itself differentiate product function.
- Mainnet record, adoption and audits are not claimed and none exist for comparison here.

## 5. Gaps the owner may need to close
- Read the QIE release directly (S1/S2 blocked) and find any official SpendGrid submission page or contract address; check explorer for a deployed SpendGrid contract to settle D1.
- Read the unread tail of S5 and any x402 spec text on `PAYMENT-IDENTIFIER`/idempotency extensions, if present.
- Fetch Zodiac and Safe Allowance module docs.
- Search more broadly for seller-side x402 middleware with idempotency (limited search done; not exhaustive).
