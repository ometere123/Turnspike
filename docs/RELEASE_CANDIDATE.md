# Release: status, verification and rollback

**Released 26 November 2026.** https://turnspike-qie.vercel.app serves commit `10864006ca0c30412f9ba81008c128710d257218` (merge of PR 15, Vercel deployment `turnspike-ct9unu44u-delealufejoel-4184s-projects.vercel.app`), on the owner's instruction. It adds the MCP section to the developers page and an MCP row to the evidence page. Live checks: home, developers, evidence and console pages load; the developers page carries the MCP section; the hosted read-only MCP server reports `payments: false`; the Fly gateway is healthy. Previous release: `c63317a` (`turnspike-heypupe19`, 24 November; earlier that day `408d67b`, `ef3864b`, `ab965a8`). It uses the Fly gateway. The contract, client and CLI are unchanged. On npm the owner published `@turnspike-qie/mcp` 0.1.0 and `@turnspike-qie/middleware` 0.1.1 (README only, same code as 0.1.0); both match the locally built tarballs byte for byte (sha512 integrity) and install cleanly. No real payment has been made through the MCP server.

## Pull requests
| PR | Disposition |
|---|---|
| [#7](https://github.com/ometere123/Turnspike/pull/7) x402 `turnspike-allowance` | **Closed, not merged.** Reasons in [`X402_DECISION.md`](X402_DECISION.md). Branch kept |
| [#8](https://github.com/ometere123/Turnspike/pull/8) Product release candidate | **Merged** 24 November 2026 |
| [#9](https://github.com/ometere123/Turnspike/pull/9) Cloudflare gateway (staging, payments off) and acceptance | **Merged** 24 November 2026. Merging it deployed nothing to Cloudflare production |
| #10, #11, #12 | **Merged** 24 November 2026: console history and second RPC; Cloudflare production record (payments off); own-address fix and M11 |

The unpushed local branch `feature/ux-clarity` is not part of this release.

## Verified on production, 24 November 2026 (first release, `ef3864b`)
- All nine routes answer 200, `/operations` included. `main` CI passed on this commit: https://github.com/ometere123/Turnspike/actions/runs/45394638648
- In Chrome: a live 402 quote on the home page; the payment of 19 November 2026 (project operated) read from QIE and matched with the gateway's `DELIVERED` record. No Turnspike console error.
- `live.spec.ts`: 3 of 4 passed at first; the fourth timed out because QIE's first RPC did not answer, and the page said "Not verified". It then passed three times. The site used one RPC at that commit. The fallback to the second RPC, and its tests (OPS-5b, OPS-5c, LIVE-05, LIVE-06), came in PR #10 and are live. PR #10 also fixed the console's transaction history, which could not load on mainnet (QIE refuses log ranges above 10,000 blocks).
- Vercel runtime logs: the plan keeps about one hour. Read within it, production had no error records (the site is static, so few or none are expected). Earlier hours cannot be read.

## Does a merge deploy?
No. The Vercel project has no connected Git repository (`link: null`). To deploy a reviewed commit, from a clean checkout of it at the repository root (the project's root directory is `apps/web`):
```powershell
vercel link --yes --project turnspike-qie --scope delealufejoel-4184s-projects; vercel deploy --prod --scope delealufejoel-4184s-projects
```
Then check, read-only: `LIVE_URL=https://turnspike-qie.vercel.app npx playwright test --config live.config.ts` in `apps/web-e2e`.

## Rollback
To the previous release: `vercel rollback turnspike-heypupe19-delealufejoel-4184s-projects.vercel.app --scope delealufejoel-4184s-projects`. To the version before this release (commit `01c7f3b`):
```powershell
vercel rollback turnspike-1hmdxwn3z-delealufejoel-4184s-projects.vercel.app --scope delealufejoel-4184s-projects
```
The site has no migration and no server state, so this is complete.

## Definition of done
| Item | State |
|---|---|
| No open automatable P0/P1 | see the review table in `RELEASE_QA.md` |
| Hardhat, Vitest, local end-to-end, web and browser CI on the exact commit | checks on the PR head and on `main` after the merge |
| Browser evidence at three widths, light and dark | `RELEASE_QA.md`, `screenshots/rc/`, CI artifact `browser-results` |
| Mainnet receipt read from two RPCs; gateway compared separately; QIE ID live schema checked | `RELEASE_QA.md` |
| Crash, restart, concurrency, backup and restore | local only, passing: `TEST-M09`, `SEC-E`, `SEC-F`, `REC-1`, `LEASE-*`, `BAK-1`, `CL-11` to `CL-30` |
| Bytecode caveat, no refunds, no external users | README, JUDGE.md, site, application |
| Human review, contribution log, video approval, release approval, submission | **owner only**, not done by this release |
| External developer trial, seller-experience expansion | **deferred, not blockers** |
