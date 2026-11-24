# The gateway on Cloudflare

`apps/gateway-cf`: one stateless Worker and one Durable Object per merchant (`Ledger`, SQLite storage). Same protocol (`turnspike/1`), resource ids, prices and proofs as the Express gateway, so the published SDK and CLI work unchanged. It holds no signing key, so the playground's scripted agent is not part of it.

| | URL | Payments |
|---|---|---|
| Staging | https://turnspike-gateway-staging.delealufejoel.workers.dev | off, no secrets set |
| Production, deployed 24 November 2026 from `ab965a8` | https://turnspike-gateway.delealufejoel.workers.dev | **off**, no secrets set. The site does not use it |

**Owner's decision, 24 November 2026:** the live site stays on Fly. Cloudflare stays behind it as a standby with payments off. If Fly stops, follow the cutover below.

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
`cd apps/gateway-cf && npm ci && npm test` (after a root install, `npx hardhat compile`, and building `packages/middleware` and `packages/client`). 32 tests run the built Worker in workerd, with storage on disk, against a local chain, the real contract and two RPC endpoints that can be made to fail. The process is really killed in the crash tests. Five mutations were tried: skipping the signature check, the canonical-block check, the reconcile mark, and the lease check each broke tests; removing the explicit transaction-reuse check did not, because the unique index also refuses it.

## Backup and restore
Set `ADMIN_TOKEN` (at least 32 characters) to enable `/admin/export`, `/admin/import` and `/admin/reconcile`; without it they do not exist. Import is all or nothing and refuses rows whose id does not match their contents. A later copy may move a record forward (a quote that has since been paid or delivered), never back, never to another transaction, and never over a refusal. Cloudflare also keeps 30 days of point-in-time recovery for the object; each export returns a bookmark. That path has not been rehearsed.

## Data in the Fly gateway (checked 24 November 2026, read only)
- The app `turnspike-qie` is **running** and answering. Its volume has five daily snapshots; the oldest is from 20 November, kept five days. So today the history is recoverable, and if Fly stops the app without a copy being taken it may not be.
- It holds 5 delivered payments, all project-operated (`/v1/stats`), no paid-but-undelivered ones, and unpaid challenges. Staging's own reconciliation, scanning QIE Mainnet with an empty ledger, independently found 8 `Paid` events for this merchant by block 12,057,159, including `0x7e41ccaa…`; the scan was still catching up.
- If it is lost: the payments themselves stay on chain and this gateway reports them as `PAID_UNRECORDED`. What would be gone is the challenge nonce of each request (so its proof cannot be re-verified) and the stored responses.
- **Copied on 24 November 2026 with the owner's approval.** Online backup, SHA-256 equal on both sides (`f89e0a91…b2e4de`), integrity check ok: 89 records, 5 delivered with responses, 84 unpaid quotes. All 89 imported into a throwaway local ledger. The copy is private and not in this repository. Three of the 8 payments on chain at that time are not in it: `0x07b64fda…`, `0x68a7f51a…` and `0xa33edeec…`, all from the project's own demo owner within 320 blocks of deployment, before the hosted gateway existed.
- A later copy is needed at cutover, for anything recorded since. Redeeming an old proof here also needs the old `HMAC_SECRET` as `HMAC_SECRET_PREVIOUS`; without it, imported rows are visible but not redeemable.

## State of the production ledger (24 November 2026)
With the owner's approval the Worker was deployed with payments off, a one-time `ADMIN_TOKEN` was set, the 89 rows were imported (all accepted), the chain was scanned from the deployment block to 12,141,209 with every payment decided, and the token was deleted (`/admin` answers 404; no secret remains). `/v1/stats`: delivered 5, all project-operated, external 0; `paidUnrecorded` 5: the three above and the two payments of 24 November made after the copy (`0xde6b53d5…`, `0x6aecd269…`). Those five answer `PAID_UNRECORDED`, never "unpaid". A fresh Fly copy resolves the last two.

## Decision: stay on Fly, keep the standby fresh (24 November 2026)
| | |
|---|---|
| Now | Fly serves. Cloudflare production is payments off, no secrets, reconciling every 15 minutes |
| Before judging, on "Yes, refresh the standby" | Deploy this Worker (payments off); fresh read-only Fly copy; import; delete the admin token. `paidUnrecorded` should fall from 5 to 3, the three early test payments made before the gateway existed |
| Cut over when | the gateway is unreachable for 30 minutes, or Fly sends a billing or suspension notice, and the owner says "Yes, cut over" |
| It takes | about 20 minutes; the site shows a closed gate until then, and nothing can be paid twice |
| It loses | the Playground's paid run, and redemption of proofs Fly issued (all 7 were delivered). Moving the old secret would keep the second; not recommended |
| Not proven | a real mainnet payment through the Worker. The first one needs the owner's approval: 0.001 QUSDC to `0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761` through the vault |
| Cannot be seen from here | Fly's billing status |

## Cutover (every step needs the owner's approval; steps 3 and 4 are done once, and 1, 2 and 4 are repeated with a fresh copy)
1. Copy the Fly database: `fly ssh console -a turnspike-qie -C "sh -c 'cd /app && node -e \"require(\\\"better-sqlite3\\\")(\\\"/data/turnspike.sqlite\\\").backup(\\\"/data/backup.sqlite\\\")\"'"`, then `fly ssh sftp get /data/backup.sqlite`. This writes one file on the Fly volume and changes nothing else.
2. Convert it with `node apps/gateway-cf/scripts/export-sqlite.mjs backup.sqlite > rows.json`.
3. `wrangler deploy --env production` (payments off). Set `HMAC_SECRET` to a new value, optionally `HMAC_SECRET_PREVIOUS`, and `ADMIN_TOKEN`, with `wrangler secret put … --env production`.
4. Import `rows.json`, run `/admin/reconcile` until `complete` is true, and check `paidUnrecorded` is 0 or explained.
5. Point the site at it: set `NEXT_PUBLIC_GATEWAY_URL` in Vercel and deploy. Set `PAYMENTS_ENABLED` to `true` and deploy the Worker. Make one small owner-approved purchase and check it at `/operations`.
6. Keep Fly running, with its demo off, until every challenge it issued has expired (5 minutes) and its last payments are imported.

**Rehearsed.** `test/cutover.test.mjs` runs all of this locally with the real Express gateway and its database: two copies, a payment between them, old proofs, new sales, and the way back. No payment was lost or charged twice. Until 24 November 2026 the second copy would have been refused; the fix is in this branch and **not yet in the deployed Workers**.

**Roll back:** set `NEXT_PUBLIC_GATEWAY_URL` back (or `vercel rollback`), and `PAYMENTS_ENABLED` to `false`. Do not delete the Worker or its migration: that would delete the ledger. `wrangler rollback` returns to the previous Worker code and keeps the data.
