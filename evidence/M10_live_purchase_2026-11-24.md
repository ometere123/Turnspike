# M10: one live purchase on QIE Mainnet, 24 November 2026

Approved by the owner for exactly one purchase, made through the public Playground at https://turnspike-qie.vercel.app (commit `ef3864b`) and the Fly gateway. Project operated: the demo owner, agent and merchant are the project's own wallets. It is not outside use.

| | |
|---|---|
| Transaction | `0xde6b53d5e40726d0c5096b3c5fc017bb0b91aa97b4c785f94b344c4c142b0af2` |
| Block | 12,139,856, status 1, canonical on rpc1 and rpc2 |
| Paid | 0.001 QUSDC (1,000 base units) to `0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761` through vault `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` |
| Request ID | `0x44f5253f956ac6c1b86da48b8431f3c512e14ff0d30c2f0bfcf4f021a3f447a9` |
| Gas | 94,955, fee 0.000106824375 QIE |
| Gateway | `DELIVERED`, same transaction; delivered count went from 5 to 6, external 0 |
| One payment only | one run request sent; agent nonce 30 before, 31 after; gateway counts 1 run in 24 hours |

An earlier click the same minute failed before any run was sent (the anti-abuse puzzle request timed out). Nothing was paid by it: no run counted, nonce unchanged, no vault event.

Video `TurnspikeLiveDemo.mp4` (77 s, not committed, SHA-256 `2a97b642e7096d27…`): the live site, unedited except for cuts. The Operations part was recorded a few minutes after the payment, reading the same transaction.

Defect seen: the site showed that failed puzzle request as "Refused". Nothing had been refused or sent.
