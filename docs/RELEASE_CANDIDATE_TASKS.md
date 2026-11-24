# Release task board

PASS, FAIL or BLOCKED, with how to check. Details: `RELEASE_QA.md`.

| Task | Status | Check |
|---|---|---|
| Baseline recorded | PASS | `RELEASE_QA.md` |
| Owner console states, review step, caps, exact approval, recovery of unknown outcomes | PASS (mock wallet, local chain) | `node apps/web-e2e/run.mjs -g AP-` |
| Operations: chain verdicts, gateway correlation, races | PASS | `node apps/web-e2e/run.mjs -g OP-`; `npx vitest run apps/web` |
| QIE ID display-only, fail closed, live schema read | PASS | `-g AP-13`; `npx vitest run apps/web -t "QIE ID"` |
| Every page: links, claims, widths, themes, accessibility | PASS | `-g WEB-` |
| Crash, concurrency, storage failure, backup and restore | PASS (local) | `npx vitest run packages` |
| Public gateway, RPC, explorer, npm read-only | PASS | `RELEASE_QA.md` |
| Independent agent review, findings fixed | PASS | `RELEASE_QA.md` |
| PR #7 decision | PASS (closed unmerged) | `X402_DECISION.md` |
| Preview of the exact commit | PASS | comment on PR #9 |
| Production serves `/operations` | PASS, released 24 November 2026 | `RELEASE_CANDIDATE.md` |
| Site falls back to QIE's second RPC | PASS on the branch; live when deployed | `npx vitest run apps/web`, LIVE-05, LIVE-06 |
| Copy of the Fly payment history | PASS: checksum matched, 89 rows import locally | `CLOUDFLARE.md` |
| Cloudflare production gateway | BLOCKED: owner approval. Staging only, payments off | `CLOUDFLARE.md` |
| Live demo recording with a real purchase | BLOCKED: owner approval of that purchase | `submission/DEMO_VIDEO.md` |
| Real wallet on mainnet | BLOCKED: owner only | `submission/OWNER_TASKS.md` |
| Human review, contribution log, video approval, presentation, submission | BLOCKED: owner only | `submission/OWNER_TASKS.md` |
| Restore rehearsal on the production volume | BLOCKED: production change, needs approval | `OPERATIONS.md` |
| External developer trial; seller-experience expansion | DEFERRED by the owner, not blockers | |
