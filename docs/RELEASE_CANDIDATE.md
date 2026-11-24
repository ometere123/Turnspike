# Release candidate: status, approval and rollback

Product release of 24 November 2026. Branch `feat/product-operations-and-identity`, PR #8. No contract, protocol, middleware source, client or CLI change, so nothing to publish on npm and no gateway deploy is needed.

## Pull requests
| PR | Disposition |
|---|---|
| [#7](https://github.com/ometere123/Turnspike/pull/7) x402 `turnspike-allowance` | **Closed, not merged.** Reasons in [`X402_DECISION.md`](X402_DECISION.md). Branch `feature/x402-v2-integration` kept |
| [#8](https://github.com/ometere123/Turnspike/pull/8) Product release candidate | Open. The owner asked on 24 November that nothing is merged without approval. Merging does not deploy (next section) |
| Cloudflare gateway and final product pass | Stacked on #8, draft. See [`CLOUDFLARE.md`](CLOUDFLARE.md) and [`../FULL_APP_ACCEPTANCE_REPORT.md`](../FULL_APP_ACCEPTANCE_REPORT.md) |

The unpushed local branch `feature/ux-clarity` is not part of this release: the owner has not reviewed it, and it touches the same files.

## Does a merge deploy?
No. On 24 November 2026 the Vercel project `turnspike-qie` (team `delealufejoel-4184s-projects`, root directory `apps/web`) reports no connected Git repository (`link: null`); the owner asked for the disconnect. Pushes and merges create no Vercel build. The public site therefore keeps serving commit `01c7f3b` until someone deploys by hand, and **`/operations` returns 404 on production until then**.

## Owner approval needed: production release
One decision. To approve, say "release" to the assistant, or run this yourself from a clean checkout of `main` at the merge commit:
```powershell
git -C C:\Users\USER\Desktop\turnspike-rc fetch origin; git -C C:\Users\USER\Desktop\turnspike-rc checkout --detach origin/main
```
```powershell
cd C:\Users\USER\Desktop\turnspike-rc; vercel link --yes --project turnspike-qie --scope delealufejoel-4184s-projects; vercel deploy --prod --scope delealufejoel-4184s-projects
```
Run the deploy from the repository root: the project's root directory is already `apps/web`.

Then check, read-only:
```powershell
$env:LIVE_URL="https://turnspike-qie.vercel.app"; $env:LIVE_LABEL="production"; cd C:\Users\USER\Desktop\turnspike-rc\apps\web-e2e; npx playwright test --config live.config.ts
```
and confirm `curl https://turnspike-qie.fly.dev/healthz` and an unpaid 402 from `/v1/block-summary`.

## Rollback
Production before this release: deployment `turnspike-1hmdxwn3z-delealufejoel-4184s-projects.vercel.app`, commit `01c7f3bcd494f349ee27ed54093195f8fd69387e`.
```powershell
vercel rollback turnspike-1hmdxwn3z-delealufejoel-4184s-projects.vercel.app --scope delealufejoel-4184s-projects
```
The release has no migration and no server state, so rolling back the site is complete. In Git, `git revert -m 1 <merge commit>`.

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
