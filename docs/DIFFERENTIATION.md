# Differentiation (DG-1): DRAFT for the project owner to review and adopt

**Status: draft.** The hackathon rules (HR-008) and the project docs (02 section 5) require the project owner to author and decide DG-1. This draft was prepared with AI assistance from `docs/research/DG1_RESEARCH_NOTES.md` and from the code. It becomes the owner's decision only when the owner checks the sources, edits it, and records PASS or FAIL at the bottom.

## What is implemented and tested (claims are limited to this)
| ID | Capability | Evidence in this repository |
|---|---|---|
| D1 | The payer's per-call cap, daily cap, merchant allowlist, pause and revoke are enforced inside the settlement contract, independently of the agent and the gateway | `contracts/TurnpikeAllowance.sol`; contract tests C01 to C13 (15 passing); mainnet transactions for allowed, over-cap, replay and revoke in `evidence/`; read-only mainnet simulations in `evidence/M7_mainnet_simulations.md` |
| D2 | Seller-side drop-in middleware: signed, expiring, resource-bound challenges; single-use payment consumption on-chain; a proof that authorizes one resource; durable delivery with a lease; recovery of late and crashed payments | `packages/middleware`; 39 middleware and gateway tests including a real process crash, concurrent redemption, late-payment recovery, a simulated reorg and storage failure; hosted gateway running on Fly.io |
| D3 | No admin, upgrade or rescue function in the contract | ABI check in the contract tests (SEC-008); Slither run with no High or Medium findings (`evidence/M6_static_analysis.txt`) |

## What the research found (see the research notes for sources and labels)
- x402 defines the HTTP payment flow. An academic analysis (arXiv 2605.11781, 12 May 2026, testbed on Base Sepolia) reports that the SDKs it audited lack payment-ID idempotency and resource binding, and that sending the response before settlement can produce paid-but-undelivered or delivered-but-unsettled outcomes. It also publishes mitigations. Turnpike implements mitigations of that kind at the seller; they are known ideas, not new inventions.
- Coinbase Agentic Wallets provide spending limits; where they are enforced is not stated in the documentation read.
- SpendGrid (QIE Hackathon 2, reported 4th place) is described as enforcing policy "before transactions reach the blockchain". Whether it enforces limits on-chain is **unverified**: no public repository or contract was found, and the press release itself could not be fetched.
- Several open-source hackathon projects (reported, not read) claim on-chain agent spending policy.

## What Turnpike does not claim
It did not invent agent spending limits or HTTP 402 payments. It does not claim to be first, cheapest, audited, trustless, production-ready or x402-compatible. It does not claim exactly-once execution of arbitrary handlers: the response is stored once and replayed, and handlers run at least once. It does not claim any competitor lacks a feature unless a source above says so.

## Candidate statement (for the owner to accept or rewrite)
"Turnpike lets an API charge per request in QUSDC while the payer's spending limits are enforced by the settlement contract itself, and gives the seller a proof model that binds each payment to one resource, stores the response durably before sending it, and recovers payments that arrive late or after a crash."

## Open items before this can be called PASS
1. Read the QIE Hackathon 2 release directly and look for a SpendGrid contract or repository, so D1 is compared with a verified fact and not an inference.
2. Read the remainder of the arXiv paper and confirm the mitigations Turnpike mirrors.
3. Decide whether the difference matters to the judges' "innovation" criterion, given that every ingredient is known.
4. Real adoption evidence does not exist yet; none is claimed.

## Owner decision
- [ ] PASS   - [ ] FAIL        Decided by: ____________   Date: ____________
Reasoning in the owner's words:
