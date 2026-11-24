# Release: status, verification and rollback

**Released 24 November 2026.** https://turnspike-qie.vercel.app serves commit `ef3864babc6890dec328672f4ec4ae5b0a76e61f` (Vercel deployment `turnspike-bzy8yfnay-delealufejoel-4184s-projects.vercel.app`), on the owner's instruction. It uses the Fly gateway. The contract, middleware, client and CLI are unchanged; nothing was published on npm.

## Pull requests
| PR | Disposition |
|---|---|
| [#7](https://github.com/ometere123/Turnspike/pull/7) x402 `turnspike-allowance` | **Closed, not merged.** Reasons in [`X402_DECISION.md`](X402_DECISION.md). Branch kept |
| [#8](https://github.com/ometere123/Turnspike/pull/8) Product release candidate | **Merged** 24 November 2026 |
| [#9](https://github.com/ometere123/Turnspike/pull/9) Cloudflare gateway (staging, payments off) and acceptance | **Merged** 24 November 2026. Merging it deployed nothing to Cloudflare production |

The unpushed local branch `feature/ux-clarity` is not part of this release.

## Verified on production, 24 November 2026
- All nine routes answer 200, `/operations` included. `main` CI passed on this commit: https://github.com/ometere123/Turnspike/actions/runs/45394638648
- In Chrome: a live 402 quote on the home page; the payment of 19 November 2026 (project operated) read from QIE and matched with the gateway's `DELIVERED` record. No Turnspike console error.
- `live.spec.ts`: 3 of 4 passed at first; the fourth timed out because QIE's first RPC did not answer, and the page said "Not verified". It then passed three times. The site used one RPC at that commit. The fallback to the second RPC, and its tests (OPS-5b, OPS-5c, LIVE-05, LIVE-06), are in the pull request that also updates this file, and are live only once that is deployed.
- Vercel runtime logs for production: no records in the six hours read. The site is static, so none are expected.

## Does a merge deploy?
No. The Vercel project has no connected Git repository (`link: null`). To deploy a reviewed commit, from a clean checkout of it at the repository root (the project's root directory is `apps/web`):
```powershell
vercel link --yes --project turnspike-qie --scope delealufejoel-4184s-projects; vercel deploy --prod --scope delealufejoel-4184s-projects
```
Then check, read-only: `LIVE_URL=https://turnspike-qie.vercel.app npx playwright test --config live.config.ts` in `apps/web-e2e`.

## Rollback
To the version before this release (commit `01c7f3b`):
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
