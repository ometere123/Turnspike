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

Owner `0x23187BF36c9B935189cDa33DEEEc6912bC2A211B`. Operations on the live site showed Paid event found, DELIVERED, Records agree. Revoke and withdraw had not been done when this was written.

The first `api pay` stopped with `rpc_unavailable` (a read timed out). It sent nothing: agent nonce 0 on both RPCs, vault unchanged, journal record `failed` without a transaction.

**Correction.** The gateway first counted this payment as external, because its own-address list named only the demo wallets. With the owner's approval both addresses were added on Fly (same image and volume, about a minute of restart) and here. `/v1/stats` then read delivered 7, own 7, external 0.
