# 17 — Final Handoff and Readiness

## 1. Readiness verdict: **CONDITIONALLY READY**
Ready: scope, security invariants, contract interface, gateway state machine, test plan, schedule.
Conditions before building past the contract:
1. **DG-1** differentiation PASS (due end of Nov 20). Not resolved; SpendGrid overlap is real.
2. **OD-1** track default AI + Agents; confirm by Nov 28 (see DEC-6).
3. Developer approval for the mainnet spend budget (11 §4).
Items still unverified (do not block M1): oracle feeds, finality/reorg, QUSDC pause/blacklist, `rpc2`, QIE Wallet behaviour, 90,000-gas failed calls, live Terms and AI-assistance rule.

## 2. Open decisions
| ID | Decision | Owner | Due |
|---|---|---|---|
| DG-1 | Differentiation pass/fail | developer | Nov 20 |
| OD-1 | Track | developer | Nov 28 |
| OD-2 | How the developer's own contribution is demonstrated | developer | Nov 21 |
| OD-4 | Hosting provider | developer | Nov 22 |
| OD-6 | Re-read live Terms | developer | Nov 29 |
| RD-1 | Contract reuse vs replace | agent + developer | end M1 |

## 3. Amendment coverage
| # | Amendment | Where |
|---|---|---|
| 1 | Time-box | 09 §1 |
| 2 | Differentiation gate | 02 §5, 09 §2 |
| 3 | Security invariants | 06 §5, 08, 10 |
| 4 | Payment/delivery consistency | 03 FR-014, 05 §5 |
| 5 | Oracle fallback and cut order | 03 FR-018, 05 §6 |
| 6 | Evidence-based contract reuse | 09 §2 RD-1, 15 DEC-7 |

## 4. Change from locked Stage 4.6
The global kill switch becomes an owner-level pause (DEC-1). Needs developer acceptance.

## 5. Developer handoff — first 48 hours
Day 1 (Nov 19–20): read 17, 02, 03, 06, 08; run DG-1; decide OD-2 and OD-4.
Day 2 (Nov 21): scaffold repo and CI; write TEST-C tests; start contract.
Do not deploy or spend until the tests pass and the budget is approved.
