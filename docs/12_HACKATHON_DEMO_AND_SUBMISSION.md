# 12 — Hackathon Demo and Submission

## 1. Demo script (target ≤ 120 s; every step shows a real explorer link)
| # | Time | Action | Proves |
|---|---|---|---|
| 1 | 0:00–0:10 | One sentence: DG-1 statement; name SpendGrid/x402 honestly | innovation |
| 2 | 0:10–0:30 | Owner sets caps (per-call 0.01, daily 0.05 QUSDC), allowlists merchant | FR-002, FR-003 |
| 3 | 0:30–0:50 | Agent calls `/v1/block-summary` → 402 → pays → data (pending state shown) | FR-011..FR-017 |
| 4 | 0:50–1:05 | Agent tries over-cap payment → revert `CapExceeded` | FR-005 |
| 5 | 1:05–1:20 | Replay same proof → idempotent same response, no second charge; reuse of requestId on-chain → revert | FR-006, FR-014 |
| 6 | 1:20–1:35 | Owner revokes → agent fails; owner withdraws | FR-007, FR-009 |
| 7 | 1:35–2:00 | Evidence page: contract verified, usage numbers (own vs external, real), limitations | impact, honesty |
Rehearse ×3. Pre-fund wallets. Record a fallback video of a **real** run, labelled "recording of real mainnet run (date)". If an endpoint is down, say so; do not fake.

## 2. Submission checklist (complete by 30 Nov 18:00 CET)
- [ ] Mainnet contract address + verified source (HR-004)
- [ ] Public GitHub repo, README, `docs/`, LICENSE (HR-002, HR-005)
- [ ] Live demo URL tested from a clean browser (HR-003)
- [ ] Track selected (HR-006) — OD-1
- [ ] Demo video / walkthrough
- [ ] Differentiation statement + honest comparison
- [ ] Limitations and trust assumptions section
- [ ] Commit history shows work between 1 Aug–30 Nov (HR-007), developer-authored (HR-008)
- [ ] Eligibility items (HR-011), one submission per team (HR-010)
- [ ] Terms re-read (OD-6)

## 3. Judging-criteria mapping
See [01](01_HACKATHON_REQUIREMENTS.md) §4. Impact evidence = real counts only; if there are no external callers, state that plainly and show the adoption path (npm package, README).

## 4. Pitch notes (accurate claims only)
Do say: limits enforced by the contract; single-use request IDs; crash-safe delivery; QUSDC micro-payments measured cost. Do not say: audited, trustless, first, cheapest, production-ready, x402-compatible.
