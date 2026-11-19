# 09 — Implementation Plan

Today is 19 Nov 2026. Deadline 30 Nov 23:59 CET. Schedule follows amendment 1: spec Nov 19–20, **seven dedicated build days Nov 21–27**, integration/security/rehearsal Nov 28–29, submission Nov 30 (submit by ~18:00 CET; leave six hours of buffer).

## 1. Milestones
| ID | Dates | Goal | Exit criteria |
|---|---|---|---|
| M0 | Nov 19–20 | Spec approved; **DG-1** decided; OD-1 track default confirmed | `docs/DIFFERENTIATION.md` written with PASS/FAIL |
| M1 | Nov 21–22 | Final contract + full Hardhat tests (TEST-C01..C13); **RD-1** reuse-vs-replace | all TEST-C pass locally; RD-1 recorded |
| M2 | Nov 23 | Deploy final contract to mainnet, explorer-verify, run 6 smoke txs | FR-023, TEST-D01 |
| M3 | Nov 23–25 | Middleware + gateway (FR-011..016) + tests TEST-M01..M13 | pass locally and against mainnet contract |
| M4 | Nov 25–26 | Endpoint A, demo agent; Endpoint B only if time | FR-017, FR-019 |
| M5 | Nov 26–27 | Playground, evidence page, public deploy | FR-020, FR-021, live URL |
| M6 | Nov 28–30 | Integration tests, security checks, demo rehearsal, recording, submit | submission checklist ([12](12_HACKATHON_DEMO_AND_SUBMISSION.md)) complete |

Hard stops: if M2 is not done by **Nov 24**, cut FR-018 and presentation extras immediately; if M3 not done by **Nov 26**, drop the playground to a minimal page (owner actions via the explorer's write UI plus scripts). Never cut: SEC-001..008, TEST-C02/C05..C10, TEST-M08/M09.

## 2. Decision gates
| ID | Gate | Due | Rule |
|---|---|---|---|
| OD-1 | Confirm track (AI + Agents default) | Nov 28 | change only if rules text requires |
| DG-1 | Differentiation | end Nov 20 | FAIL → stop, escalate to developer (reopen positioning) |
| RD-1 | Reuse vs replace proof-of-mechanism contract (`0x6910…DdAC`) | end M1 | Compare the multi-tenant final spec to the old contract by code review + running the old tests against the new contract. **Default: reuse the validated mechanism and test cases, deploy a new contract.** The old address is not the submission contract unless it passes every TEST-C test unchanged (it will not: single-tenant) |
| OD-4 | Hosting provider | Nov 22 | needs HTTPS public URL, persistent volume |
| OD-6 | Re-read live Terms | Nov 29 | |

## 3. Task breakdown (small, ordered)
1. Repo scaffolding, CI, secret scan, `.env.example`.
2. Contract + interface per [06](06_DATA_MODELS_AND_INTERFACES.md); tests first for SEC-001..007.
3. Deployment script (dry-run on local network, then mainnet with tiny amounts after developer approval).
4. Explorer verification script; record GUID.
5. Gateway core: challenge, HMAC, DB, verification, state machine.
6. Crash-recovery tests (kill process between states).
7. Endpoint A; demo agent; negative scenario scripts.
8. Playground; evidence page.
9. README, docs polish, honest limitations.
10. Rehearsal ×3, record fallback video, submit.

## 4. Definition of done per requirement
Code merged + test listed in [14](14_REQUIREMENTS_TRACEABILITY_MATRIX.md) passing + evidence (tx link or test output) saved under `evidence/`.

## 5. Change control
Any change to scope, security invariants, or the stack requires a dated entry in `docs/CHANGELOG.md` stating reason, effect on schedule and on the six amendments.
