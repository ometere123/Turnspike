# M11: a full owner cycle on QIE Mainnet, 24 November 2026

The owner used a real browser wallet on https://turnspike-qie.vercel.app/app (commit `ab965a8`) and signed every owner transaction. The agent key was made by the owner and paid through `@turnspike-qie/cli` 0.1.1. The assistant prepared reviews and signed nothing. Merchant and gateway are the project's own: this is project-operated, not outside use.

| Step | Block | Result |
|---|---|---|
| Pause, unpause | 12,141,044 and 12,141,053 | confirmed |
| Approve exactly 0.002 QUSDC | 12,142,028 | allowance read back as 2,000 base units |
| Deposit 0.002 QUSDC | 12,142,050 | vault balance 0.002 |
| Allow merchant `0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761` | 12,142,279 | on the allowlist |
| Policy: agent `0x8429ACBB9000Ff6a34fC5c452A73961C29B52867`, 0.001 per call, 0.002 per day | 12,142,457 | active |
| Agent pays 0.001 QUSDC: `0x6aecd269e16613c2883b44c9ec3f5fd1d121e3b1f1663d0d7fe96c86307441f8` | 12,142,945 | status 1, canonical on two RPCs, 129,155 gas, 0.000145299375 QIE, gateway `DELIVERED` |
| Revoke agent | 12,143,209 | no agent; the console cleared its form |
| Withdraw all, 0.001 QUSDC | 12,143,262 | vault 0, wallet 0.003402 on both RPCs |

Owner `0x23187BF36c9B935189cDa33DEEEc6912bC2A211B`. Operations on the live site showed Paid event found, DELIVERED, Records agree. The wallet went from 0.004402 to 0.003402 QUSDC: exactly the 0.001 the agent paid. The owner's six transactions from approve to withdraw cost 0.000360 QIE in gas (320,402 gas at 1.125 gwei, summed from the receipts). An earlier version said 0.000384: that balance difference also held the plain transfer that funded the agent.

The first `api pay` stopped with `rpc_unavailable` (a read timed out). It sent nothing: agent nonce 0 on both RPCs, vault unchanged, journal record `failed` without a transaction.

**Correction.** The gateway first counted this payment as external, because its own-address list named only the demo wallets. With the owner's approval both addresses were added on Fly (same image and volume, about a minute of restart) and here. `/v1/stats` then read delivered 7, own 7, external 0.

## Transaction hashes (read from QIE by block, all status 1)
| Step | Transaction |
|---|---|
| Pause | `0x71c63219e4ee0c57cfda633eed532b631f17e8455448e8044c35dbf4526b0aca` |
| Unpause | `0xfb24b94aa5f2d2ed627f45907b1983806a99f2b8258b698b25c1b4ce5c2d6d12` |
| Approve | `0x34d991f7bf19b7efc314826b18854bc24af9527e25578e8e22c17b34858208e3` |
| Deposit | `0x509b1f64f64e3a4aabb4415f12177a225356aa4f2754cfffb90fd09966f8c4de` |
| Allow merchant | `0x40813d67656d99b1903cd1448da77a23aca8016bde41f5b4b398d118607eb0a2` |
| Policy | `0x424d48bef73ead44a1161f952f93a46029eafbd354527d27c23be8e009b3584b` |
| Agent payment | `0x6aecd269e16613c2883b44c9ec3f5fd1d121e3b1f1663d0d7fe96c86307441f8` |
| Revoke | `0x672a8e7518ad23ee4959c4343e2da5a6eb7b435bf66e97ecebd57665b22ee7bb` |
| Withdraw | `0xe79273e4ecf69c265f482b4fec7c65bf6e292f13a81107fc803e4dc0825914c6` |
