# Change log (change control, doc 09 section 5)

## 2026-11-19 — RD-1 recorded: replace, reuse mechanism and test cases
The Stage 4 contract (`0x6910…DdAC`, single-tenant, `pay(merchant,requestId,amount)`) is not the submission contract. The final contract `contracts/TurnpikeAllowance.sol` is a new multi-tenant file (`pay(owner,merchant,requestId,amount)`), per DEC-4 and DEC-7. The validated mechanism (per-call cap, replay key, Paid event) and its test cases were carried over. Effect on schedule: none. Amendment 6 satisfied.

## 2026-11-19 — Spec addition: `pay` reverts on `amount == 0` (`ZeroAmount`)
Not listed in doc 06; added to avoid zero-value requestId consumption. No effect on SEC invariants.

## 2026-11-19 — Stage 4 evidence imported
`evidence/stage4/` holds the Stage 4 reports (no secrets). QUSDC source shows no pause, blacklist or transfer tax; only role-gated mint/burn. This is source-reading, not an execution test (TEST-X02 stays open).
