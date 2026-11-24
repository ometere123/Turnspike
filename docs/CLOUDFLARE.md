# The gateway on Cloudflare

`apps/gateway-cf`: one stateless Worker and one Durable Object per merchant (`Ledger`, SQLite storage). Same protocol (`turnspike/1`), resource ids, prices and proofs as the Express gateway, so the published SDK and CLI work unchanged. It holds no signing key, so the playground's scripted agent is not part of it.

| | URL | Payments |
|---|---|---|
| Staging | https://turnspike-gateway-staging.delealufejoel.workers.dev | off, no secrets set |
| Production (`wrangler deploy --env production`) | not deployed | off by default |

## Why it is safe
- Every record is in the Durable Object's SQLite. Nothing authoritative is in memory or KV. State changes are synchronous and transactional, so two requests cannot interleave inside one.
- A transaction backs one request (unique index). Delivery takes a lease with a fencing token. The response is stored before a byte is sent. A failed or killed handler leaves the payment redeemable.
- One RPC endpoint answers every question behind a decision, after proving its chain id; receipts count only on the canonical chain. If no endpoint answers, the result is 503, never "unpaid".
- **A request this gateway has no record of is checked on chain.** If it was paid: `PAID_UNRECORDED`, and 503 with "do not pay again". Reconciliation (every 15 minutes) lists such payments and counts them in `/v1/stats` as `paidUnrecorded`. The mark only moves when every payment found was decided.
- `PAYMENTS_ENABLED=false` stops new quotes; anything already paid stays redeemable.
- A daily quote budget and a per-caller limit stop unpaid traffic from using up the account's write quota.

## Free plan (read from Cloudflare's documentation, 24 November 2026)
100,000 requests a day; 10 ms CPU per request; 50 subrequests; 5 cron triggers. Durable Objects: 100,000 requests, 5 million rows read and 100,000 rows written a day, 5 GB. Beyond a limit, operations fail until 00:00 UTC; nothing is billed. Measured on staging: 0 to 5 ms CPU. A quote writes 2 rows, so the default budget of 10,000 quotes uses a fifth of the writes. A large `/v1/qusdc-activity` report parses up to 20 log pages and is the one route that could approach 10 ms; if it is cut off, the payment stays redeemable.

## Tests
`cd apps/gateway-cf && npm ci && npm test` (after a root install, `npx hardhat compile`, and building `packages/middleware` and `packages/client`). 30 tests run the built Worker in workerd, with storage on disk, against a local chain, the real contract and two RPC endpoints that can be made to fail. The process is really killed in the crash tests. Five mutations were tried: skipping the signature check, the canonical-block check, the reconcile mark, and the lease check each broke tests; removing the explicit transaction-reuse check did not, because the unique index also refuses it.

## Backup and restore
Set `ADMIN_TOKEN` (at least 32 characters) to enable `/admin/export`, `/admin/import` and `/admin/reconcile`; without it they do not exist. Import is all or nothing, refuses rows whose id does not match their contents, and never overwrites. Cloudflare also keeps 30 days of point-in-time recovery for the object; each export returns a bookmark. That path has not been rehearsed.

## Data in the Fly gateway (checked 24 November 2026, read only)
- The app `turnspike-qie` is **running** and answering. Its volume has five daily snapshots; the oldest is from 20 November, kept five days. So today the history is recoverable, and if Fly stops the app without a copy being taken it may not be.
- It holds 5 delivered payments, all project-operated (`/v1/stats`), no paid-but-undelivered ones, and unpaid challenges. Staging's own reconciliation, scanning QIE Mainnet with an empty ledger, independently found 8 `Paid` events for this merchant by block 12,057,159, including `0x7e41ccaa…`; the scan was still catching up.
- If it is lost: the payments themselves stay on chain and this gateway reports them as `PAID_UNRECORDED`. What would be gone is the challenge nonce of each request (so its proof cannot be re-verified) and the stored responses.
- **Copied on 24 November 2026 with the owner's approval.** Online backup, SHA-256 equal on both sides (`f89e0a91…b2e4de`), integrity check ok: 89 records, 5 delivered with responses, 84 unpaid quotes. All 89 imported into a throwaway local ledger. The copy is private and not in this repository. Three of the 8 payments on chain are not in it; where they came from is not established.
- A later copy is needed at cutover, for anything recorded since. Redeeming an old proof here also needs the old `HMAC_SECRET` as `HMAC_SECRET_PREVIOUS`; without it, imported rows are visible but not redeemable.

## Cutover (every step needs the owner's approval)
1. Copy the Fly database: `fly ssh console -a turnspike-qie -C "sh -c 'cd /app && node -e \"require(\\\"better-sqlite3\\\")(\\\"/data/turnspike.sqlite\\\").backup(\\\"/data/backup.sqlite\\\")\"'"`, then `fly ssh sftp get /data/backup.sqlite`. This writes one file on the Fly volume and changes nothing else.
2. Convert it with `node apps/gateway-cf/scripts/export-sqlite.mjs backup.sqlite > rows.json`.
3. `wrangler deploy --env production` (payments off). Set `HMAC_SECRET` to a new value, optionally `HMAC_SECRET_PREVIOUS`, and `ADMIN_TOKEN`, with `wrangler secret put … --env production`.
4. Import `rows.json`, run `/admin/reconcile` until `complete` is true, and check `paidUnrecorded` is 0 or explained.
5. Point the site at it: set `NEXT_PUBLIC_GATEWAY_URL` in Vercel and deploy. Set `PAYMENTS_ENABLED` to `true` and deploy the Worker. Make one small owner-approved purchase and check it at `/operations`.
6. Keep Fly running, with its demo off, until every challenge it issued has expired (5 minutes) and its last payments are imported.

**Roll back:** set `NEXT_PUBLIC_GATEWAY_URL` back (or `vercel rollback`), and `PAYMENTS_ENABLED` to `false`. Do not delete the Worker or its migration: that would delete the ledger. `wrangler rollback` returns to the previous Worker code and keeps the data.
