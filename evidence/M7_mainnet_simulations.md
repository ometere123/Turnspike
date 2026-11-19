# Read-only simulations against the deployed contract (QIE Mainnet, eth_call, no transactions, no gas)

Contract 0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c, run 2026-11-19 with `cast call --from <caller>`.

| Case | Caller | Result | Matches selector |
|---|---|---|---|
| pay to a merchant the owner never allowlisted (0x...dEaD) | the configured agent 0xF35F...6433 | reverted, data 0x84d9e4ff | `MerchantNotAllowed()` = 0x84d9e4ff |
| pay by an address that is not the owner's agent | 0x...dEaD | reverted, data 0xa6afae99 | `NotOwnerAgent()` = 0xa6afae99 |

These are simulations of the contract's current state, not mined transactions. They support the "unauthorized merchant" and "wrong caller" negative cases; the revoked-agent and paused-account cases are covered by local tests and, for revoke, by the mainnet transactions in M4_mainnet_demo.json.
