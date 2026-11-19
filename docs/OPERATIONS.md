# Operating a Turnspike gateway

Applies to `apps/gateway` (hosted at https://turnspike-qie.fly.dev) and to any seller using `@turnspike/middleware`.

## Deployment and health
- Fly app `turnspike-qie`, region ams, one shared-cpu machine, volume `turnspike_data` mounted at `/data`, database `/data/turnspike.sqlite`.
- The image is multi-stage: compiled JavaScript and production dependencies only; no TypeScript, Hardhat or test tooling at runtime.
- Health check: `GET /healthz` every 30 s. Status: `/demo/status` (budget, gas health), `/v1/stats` (deliveries, paid-but-undelivered).
- Deploy: `fly deploy -a turnspike-qie --ha=false`. A single machine is deliberate: the demo agent uses one nonce sequence.

## Configuration and secrets
- Non-secret configuration lives in `fly.toml` `[env]`. Secrets: `HMAC_SECRET`, `DEMO_AGENT_KEY`, `PUBLIC_BASE_URL` (`fly secrets list` shows digests only).
- **HMAC rotation:** set the new value as `HMAC_SECRET` and the old as `HMAC_SECRET_PREVIOUS`, deploy, wait at least `CHALLENGE_TTL_SECONDS` plus the longest redemption you want to honour, then remove the previous secret. Proofs signed with either verify meanwhile.
- **Demo agent key rotation:** create a new agent key, have the owner call `setPolicy(newAgent, …)` in the web console (this replaces the agent and revokes the old one on chain), set `DEMO_AGENT_KEY`, deploy, then move remaining gas from the old key.
- The web app (Vercel project `turnspike-qie`) has no secrets: only `NEXT_PUBLIC_*` values, which are public by design.

## Backup and restore
- Fly takes daily volume snapshots (retention 5). Manual consistent backup without stopping the app:
  `fly ssh console -a turnspike-qie -C "sh -c 'cd /app && node -e \"require(\\\"better-sqlite3\\\")(\\\"/data/turnspike.sqlite\\\").backup(\\\"/data/backup.sqlite\\\")\"'"` then `fly ssh sftp get /data/backup.sqlite`.
- Restore: copy the file to `/data/import.sqlite`, then `rm -f /data/turnspike.sqlite-wal /data/turnspike.sqlite-shm && mv /data/import.sqlite /data/turnspike.sqlite`, then `fly machines restart`. This is how the database was moved from the old `turnpike-qie` app on 2026-11-19 (checksums matched).
- After any restore, the next reconcile (at start and every 15 minutes) re-attaches payments made on chain since the backup, so a restored database does not lose payments that reached the chain; it loses only stored responses, which are produced again by the handler on the next proof (handlers are idempotent).

## Database migrations
Migrations are additive and run at start (`Store` constructor): new columns (`agent`, `leaseUntil`, `leaseToken`, `responseEncoding`, `responseHeaders`), the `meta` table and an index. Old rows stay readable (legacy text responses are treated as UTF-8). Never drop or rename columns in place.

## Failure recovery
| Situation | What happens | Operator action |
|---|---|---|
| Gateway down while agents pay | Payments are on chain; proofs fail to connect | None. On restart, reconcile finds them; agents' `resume` redeems |
| Crash during a handler | Row stays `DELIVERING` until the lease lapses, then the next proof re-runs the handler | None |
| RPC 1 down | Middleware fails over to RPC 2 per request | Check `turnspike network status` |
| Both RPCs down | Proofs get `503 rpc_unavailable`; nothing is marked paid or refused | Wait or add an RPC URL |
| Disk full / SQLite error | `503 storage_unavailable`; nothing is sent that is not stored | Grow the volume |
| Demo agent low on gas | Demo refuses with `demo_funds_low` before using a visitor's quota | Send QIE to the agent |
| Abuse of the demo | Proof of work, per-IP hourly and daily quotas, global daily budget, kill switch `DEMO_ENABLED=false` | Lower limits or disable |

## Observability
JSON lines on stdout: `payment_state` transitions, `challenge_issued`, `delivery_started`, `delivered`, `delivery_failed`, `delivery_superseded`, `payment_rejected`, `reconciled`, `reconcile_failed`, `demo_run`. Each priced request has an `x-correlation-id`. Logs never contain keys, proof sigs, or response bodies. `fly logs -a turnspike-qie`.

## Known limits
- One SQLite file per deployment; horizontal scaling needs a shared database adapter (not built).
- Finality on QIE is probabilistic; 2 confirmations is a configured trade-off, not a proven bound.
- The contract's replay key is `(merchant, requestId)`; see the middleware README.
