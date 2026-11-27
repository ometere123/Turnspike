# 01 — Hackathon Requirements

Sources: the user-supplied rules sheet (treated as authoritative; it states it was verified against the official site and Terms), plus reviewer-reported details marked **[REPORTED]**. I did not open hackathon.qie.digital or the Terms myself. The ToS "last updated" date is inconsistent across sources (Oct 26 / Nov 2 / Nov 18, 2026): **re-read the live Terms before submission** (OD-6).

## 1. Event facts
| Item | Value | Status |
|---|---|---|
| Organiser | QIE Blockchain | rules sheet |
| Site / Terms | https://hackathon.qie.digital/ · https://hackathon.qie.digital/terms | links from rules sheet |
| Development window | 1 Aug – 30 Nov 2026 | rules sheet |
| **Final submission** | **30 Nov 2026, 23:59 CET (= 23:59 WAT)** | rules sheet |
| Demo/judging | 1–5 Dec 2026 | rules sheet |
| Winners | 10 Dec 2026 | rules sheet |
| Prize pool | ~$17,000 **[REPORTED]**; paid in QIE tokens | Terms per sheet |
| Payout | 50% on 10 Dec; 50% after three traction milestones within 90 days; numeric targets unpublished | rules sheet |
| Positioning | "Build the Company, not the Demo" **[REPORTED]** | reviewers |

## 2. Confirmed rules (requirement IDs used across the package)
| ID | Rule | Mapped to |
|---|---|---|
| HR-001 | **Mainnet deployment is mandatory** (testnet-only ineligible) | FR-023, M2–M5 |
| HR-002 | Public GitHub repository with source | M6, SUB-1 |
| HR-003 | Publicly accessible live demo URL | FR-020, M5 |
| HR-004 | Deployed smart-contract address (mainnet) | FR-001..FR-010, M2 |
| HR-005 | Comprehensive project documentation | this package, M6 |
| HR-006 | Select one of five tracks | OD-1 |
| HR-007 | Original work developed 1 Aug–30 Nov 2026 | process rule PR-1 |
| HR-008 | Not predominantly AI-generated; genuine developer contribution | PR-2 |
| HR-009 | Functional live product or working demonstration | FR-019..FR-021 |
| HR-010 | One submission per team | — |
| HR-011 | 18+, valid QIE wallet, not a QIE employee/affiliate, email-verified account | developer |
| HR-012 | No recycled/forked code, plagiarism, simple clones, fake accounts, judging interference | PR-1 |
| HR-013 | Comply with intellectual-property rights | licences in 15 |

**Process rules the implementation must obey**
- PR-1 (HR-007/HR-012): All Turnpike code is written inside the window. The earlier proof-of-mechanism contract is the developer's own Stage 4 work in the window; the final contract is a new file. No code copied from SpendGrid, x402 repos, or starter templates beyond OpenZeppelin libraries (declared in 15).
- PR-2 (HR-008): Keep a visible, human-authored commit history; the developer must be able to explain every contract line. AI assistance is not banned by the rules **[the FAQ answer was not retrievable]**, but "predominantly AI-generated with little genuine developer contribution" is disqualifying. See OD-2 for the contribution plan.

## 3. Tracks
DeFi & Financial Infrastructure · **AI + Autonomous Agents (locked default)** · Consumer Apps & Social · Commerce & Real World · Developer Infrastructure & Tooling (permitted areas include APIs, SDKs, wallet tooling). Turnpike fits AI + Agents (on-chain agent operations) and Developer Infrastructure; final choice OD-1.

## 4. Judging
**Published weights (Terms): four categories, 25% each.**
| Category | Turnpike evidence we must produce |
|---|---|
| Innovation & creativity | Differentiation statement (DG-1) and honest comparison to SpendGrid/x402 in README |
| Technical implementation & quality | Verified contract, tests, threat model, crash-recovery design, reproducible negative tests |
| Real-world impact & applicability | One real third-party-usable endpoint set, published package, live public gateway, honest usage numbers |
| Presentation & demonstration | ≤120 s demo with real explorer links ([12](12_HACKATHON_DEMO_AND_SUBMISSION.md)) |

Homepage/X emphasise product UX, ecosystem integration and adoption potential **[REPORTED]**; integrating several QIE components (Wallet, QUSDC, QIE ID/Pass, QIEDEX, oracles) earns **unquantified** bonus consideration. Turnpike uses QUSDC + QIE Wallet (owner flows). The planned QIE Oracle endpoint (FR-018) was cut and is not integrated; QIE ID is used as an optional read-only name check. No numeric bonus is assumed.

## 5. Required evidence for judging
mainnet contract address + verified source; explorer links for the demo flow (allowed, refused, replay, revoke, withdraw); live URL; repo; docs; recorded fallback clearly labelled as a recording of a real run.

## 6. Strategic recommendations (not rules)
Show real usage (own endpoints + any outside caller); disclose QUSDC admin-mint/burn privileges as a trust assumption; explicitly acknowledge SpendGrid and x402 rather than ignoring them.
