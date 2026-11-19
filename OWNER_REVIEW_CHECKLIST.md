# Owner review checklist

This file is for the project owner. It lists the decisions that matter, where they live in the code, and how to check each one yourself. **The observation column is intentionally blank.** Nothing here records that a review has happened. Fill it in as you go; `docs/HUMAN_REVIEW_LOG.md` is where completed work is logged.

Setup for every "run" entry: `npm ci --legacy-peer-deps` at the repo root, `npx hardhat compile`, then the command shown. Tests use a local Hardhat chain and a labelled mock ERC-20; they never touch mainnet.

| # | Decision | Why it was made | Files | Run | Your observations |
|---|---|---|---|---|---|
| 1 | Limits are enforced inside `pay()` on chain, not by the SDK or the seller | A compromised agent or seller must not exceed the owner's rules | `contracts/TurnpikeAllowance.sol` | `npx hardhat test` (15 tests incl. fuzz) | |
| 2 | No admin, upgrade or rescue function | Owners need not trust the deployer; cost: no fix without redeploy | same; test SEC-008 | same | |
| 3 | Replay key is `(merchant, requestId)`, single use forever | Cheap on-chain replay stop; a cross-owner collision is possible and documented | same; `docs/PROTOCOL.md` | same | |
| 4 | Fixed UTC-day daily cap (up to 2x across midnight) | Simple and auditable; disclosed limitation | same; `docs/15_RESEARCH_SOURCES_AND_TECHNICAL_DECISIONS.md` DEC-2 | same | |
| 5 | Challenge is HMAC-signed, expiring, bound to method, path and sorted query (optional body, identity) | A payment must unlock only the thing quoted | `packages/middleware/src/index.ts` (`resourceIdFor`), `challenge.ts` | `npx vitest run packages/middleware` | |
| 6 | The `sig` is the secret half of the proof, required on every redemption | A txHash is public once mined; without the sig anyone could fetch a paid response | `index.ts` header comment, step 1 | middleware security tests | |
| 7 | Payment deadline = challenge expiry + 60 s of chain time; redemption may come later | An outage must not cost a payer their resource, but a quote must not stay payable for a day | `verify.ts`, `index.ts` | TEST-EXP-1, TEST-REC-1 | |
| 8 | Response stored byte-exact before it is sent; fenced delivery lease; handlers run at least once | No client holds data the DB does not know about; stale handlers cannot overwrite | `index.ts` (`deliver`), `store.ts` | TEST-LEASE-*, TEST-RESP-1 | |
| 9 | Reconcile scans chain logs; unpaid rows purged only after reconcile past deadline plus retention | Payments made during an outage are not lost | `index.ts` (`reconcile`), `store.ts` (`purgeUnpaid`) | TEST-REC-1, TEST-SEC-J | |
| 10 | SDK refuses unknown payees, wrong network, price above ceiling and owner-policy violations before broadcasting | An agent must never pay an arbitrary 402 | `packages/client/src/client.ts` (`quote`) | `npx vitest run packages/client` (17) | |
| 11 | SDK journals nonce before broadcast; `resume()` never pays twice. This review added an expiry check to the never-broadcast resume path | A crash must not double-pay or pay a dead quote | `client.ts` (`resumeRecord`), `journal.ts`; test CL-11b | same | |
| 12 | CLI reads agent keys from encrypted keystores only and will not pay non-interactively without `--yes` | Keys never on the command line or in env | `packages/cli/src/cli.ts` | `npx vitest run packages/cli` (10) | |
| 13 | Public demo guarded by proof of work, per-IP quotas, a global tx budget and a gas floor | The demo agent key is a spendable hot key | `apps/gateway/src/demo-guard.ts`, `server.ts` | `npx vitest run apps/gateway` | |
| 14 | Naming: Turnspike everywhere except on-chain and historical identifiers (`TurnpikeAllowance`, `evidence/`) | The contract is deployed; renaming means redeploying | `docs/OWNER_DECISIONS.md` D2, D3 | | |
| 15 | Web redesign ("toll plaza") | Clarity of the two journeys | `apps/web/DESIGN.md` | `cd apps/web && npm run typecheck && npm run lint && npm run build` | |

Questions you should be able to answer without notes before submitting: why `sig` is secret; what happens if the seller crashes after payment; what the 2x midnight limitation means; why there is no refund; what QUSDC's issuer can do (mint and burn by role); why the project is not x402-compatible.
