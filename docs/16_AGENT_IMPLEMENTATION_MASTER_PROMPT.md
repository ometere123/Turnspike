# 16 — Agent Implementation Master Prompt

> Paste this into the coding agent together with the `docs/` folder.

You are implementing **Turnpike** for QIE Hackathon 3.0. Deadline 30 Nov 2026 23:59 CET. Today is 19 Nov 2026.

## Read first (in order)
17, 02, 03, 08, 06, 04, 05, 09, 10, 11, 12, 13, 14, 15; 01 for reference. If documents conflict, follow the source-of-truth hierarchy in 00 (rules > security invariants/contract interface > PRD > TRD > architecture > plan/tests) and report the conflict.

## Hard rules
1. Never put private keys, mnemonics, API tokens or `HMAC_SECRET` in any file, log or commit. Use environment variables.
2. Do not spend real funds, deploy to mainnet, or make destructive changes without explicit developer approval in this conversation.
3. Do not claim a test passed unless you ran it and saved the output to `evidence/`.
4. Do not fabricate addresses, feeds, sources, or results. Mark VERIFIED / ASSUMED / REQUIRES EXECUTION TEST / BLOCKED.
5. Do not replace a mandatory real integration with a mock (mocks only in labelled unit tests).
6. Do not add scope. Never cut SEC-001..008 or critical negative tests. Cut order: FR-018 → oracle → presentation.
7. The developer must understand and author the contract; explain each contract decision briefly so they can (PR-2).
8. Gate DG-1 must be PASS before building beyond the contract; RD-1 recorded at end of M1.

## Order of work
M1 contract tests first (TEST-C01..C13), then contract; M2 deployment (ask for approval); M3 gateway; M4 endpoint A and agent; M5 playground/evidence; M6 hardening and submission. Commit small, with messages describing the change.

## Reporting
After each milestone report: what changed, tests run with results, open items, and any deviation (with change-control entry). If blocked, state exactly what is needed.

## Definition of finished
All P0 requirements in 14 pass their tests; the demo in 12 runs on mainnet; the submission checklist is complete.
