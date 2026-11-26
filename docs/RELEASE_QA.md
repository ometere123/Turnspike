# Release QA record (PR #8, 24 November 2026)

Machine: Windows 11 Pro 10.0.26200, Node 22.23.3, npm 10.9.9; CI: ubuntu-latest, Node 22. Browser: Chromium via Playwright 1.65.1. **Code commit of the browser and live runs: `b7c061f`.** Later commits change tests, documentation and the recorder only; the checks on the PR head and on `main` are the final word for the exact commit.

## Baseline before any change (`17b25c7`)
Hardhat 15 passing, Vitest 105 passing, `END-TO-END OK`, web typecheck, lint and build in CI. `npm ci` failed twice on this Windows machine (npm tried to rebuild better-sqlite3 without Visual Studio); `--ignore-scripts` works and is now documented.

## Automated results on the candidate
| Suite | Result | Command |
|---|---|---|
| Contract | 15 passing | `npx hardhat test` |
| Middleware 32, gateway 18, SDK 39, CLI 11, web unit 24, MCP 14 (25 November) | 138 passing | `npx vitest run` (build `packages/mcp` first) |
| Read-only MCP server in workerd | 4 passing | `apps/mcp-cf`, `npm test` |
| Two-sided local run on built packages | END-TO-END OK | `node examples/end-to-end/run.mjs` |
| Browser, local chain | 66 passing (evening of 24 November; 63 on the first candidate) | `node apps/web-e2e/run.mjs` |
| Cloudflare gateway in workerd, with the cutover rehearsal | 32 passing | `apps/gateway-cf`, `npm test` |
| Live read-only, production `c63317a` | 7 passing | `apps/web-e2e`, `live.config.ts` |
| Production dependency audit | 0 vulnerabilities (root, web) | `npm audit --omit=dev` |
| Secret scan, Slither | pass, in CI | `.github/workflows/ci.yml` |

## Browser coverage (local chain 1990, real contract, mock token, real gateway process, mock wallet)
Nine routes at 390, 768 and 1440 px, light and dark, reduced motion: no page overflow, one h1, no WCAG A/AA axe violation, no script error. Connected console at the same sizes. Keyboard, focus return, Escape, mobile menu, every internal link and anchor, offline gateway, slow network, rate limits.
Operations: valid, unknown, pending, reverted, unrelated, two events, other contract, replaced block, wrong chain, lagging and stalled RPC, one confirmation, gateway 404, 429, 500, unreachable, malformed, hash and request-ID mismatch, conflict with a reverted transaction, input changed while a read is in flight.
Console: no wallet, rejected connection, full owner lifecycle with exact calldata, deposit cap, bad addresses, rejected signature, wrong network, silent network or account change, switch during the final check, pending transaction beside another review, dropped transaction, lost confirmation, no gas, RPC down or on another chain, QIE ID in six states.
Screenshots: `screenshots/rc/`. Full set and traces of failures: CI artifact `browser-results`.

## Recovery (local, disposable data)
Crash and restart `TEST-M09`; concurrent redemption `SEC-E`; storage failure `SEC-F`, `SEC-G`; reorg `SEC-H`; reconcile `REC-1`; fenced leases `LEASE-1`, `LEASE-2`; backup, total loss and restore `TEST-BAK-1`; client journal, ambiguous outcome and concurrency `CL-11` to `CL-30`. Not done: a restore rehearsal on the production volume.

## Public read-only checks, 2026-11-24 08:52 UTC
- Gateway `/healthz` 200; `/v1/config` matches the site's chain, vault and token; `/v1/stats` delivered 5, own 5, external 0, paid-but-undelivered 0; unpaid `/v1/block-summary` 402.
- rpc1 and rpc2 agree: chain 1990; vault code 9,610 bytes; payment `0x7e41ccaa` status 1, block 12,015,683, canonical, 92,159 gas; `0x7b441473` and `0x4092c6a8` reverted; revoke `0xe860b210` succeeded. Explorer pages for the vault and the payment return 200.
- Gateway record for the payment's request ID: DELIVERED, same hash.
- QIE ID API: reverse and forward schema, 404, CORS `*`, 30 requests per minute. The demo merchant has no name.
- Production site: all existing routes 200; `/operations` 404 (not released yet). npm: middleware 0.1.0, client 0.1.1, cli 0.1.1.

## Independent review
A separate agent with a clean session read the diff and built its own clone at `ed8544e`. No P0. All twelve findings were fixed: two P1 (a pending transaction blocked the next review; unbounded confirmation wait), three P2 (switch between the last check and the wallet prompt; unreadable run answer shown as refused; gateway/chain conflict not shown), seven P3. New tests: AP-14 to AP-17, OP-18, WEB-09b, OPS-10, QIE ID malformed answers. It is an AI review, not a human review and not an audit. Re-review at `b01fc45`: no P0 or P1; its one P2 (no warning when another transaction is still pending) and two P3 were fixed, the rest are listed below.

## Known and accepted
| Item | Priority | Why it can wait |
|---|---|---|
| A preview cannot reach the live gateway: its CORS list holds only the production origins and localhost:3000 | P3 | Changing it is a production change. Live checks ran from localhost:3000 |
| `next lint` is deprecated upstream | P3 | Works in the pinned version |
| The test setup kills processes the Windows way; on Linux it leaves them to the runner | P3 | CI is green; the fix is on the x402 branch |
| Transactions sent from the console are not remembered across a reload | P2 | On-chain history shows them once mined; no retry is offered for them |
| A speed-up in the wallet stays "Outcome unknown" here; Retry is used up by a cancelled review; leaving the page mid-signature loses the row until it is in the history | P3 | All fail towards "check it", never towards a second send |
| QIE Wallet, MetaMask, mobile wallets and screen readers were not used | not run | Needs a person |

## Video
See `submission/video/README.md`.
