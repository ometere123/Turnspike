# Meter402 — QIE Mainnet Feasibility Report

Date: 2026-11-19  
Network: QIE Mainnet  
Chain ID: 1990  
Outcome: **PASS**

## Summary

The required QIE Mainnet tests completed with real transactions. QUSDC behaved as a standard 6-decimal ERC-20 in the tested paths, with no transfer fee observed. The policy contract authorized valid payments, rejected cap violations, rejected replayed request IDs, and emitted decodable `Paid` events. All ten reliability payments succeeded and their receipts were retrievable.

The explorer’s `Stub Token (goerli)` display text remains a documented metadata anomaly. It did not match the verified QUSDC source, live metadata, bytecode, or the independent recompilation and was not treated as a blocker after the Stage 4 resolution.

## Gate results

| Check | Result | Evidence |
|---|---|---|
| Chain ID | PASS | Both `https://rpc1mainnet.qie.digital` and `https://rpc2mainnet.qie.digital` returned `1990`. |
| QUSDC bytecode | PASS | Both RPCs returned runtime Keccak `0x86c3675b798fef82ca801afa2f12eae09dfaa68772389ef78fa33cf18a649510`. |
| QUSDC identity | PASS | On-chain `name=QUSDC`, `symbol=QUSDC`, `decimals=6`. |
| Independent recompilation | PASS | Solidity `0.8.20`, optimizer disabled, EVM `berlin`; compiled and deployed runtime both 6,096 bytes. After stripping the 51-byte CBOR metadata trailer, executable-core hash matched: `0xbbcea2fb7aec43b022be6326432ed4edf0f53b688bfac218f4c1792ae27dece5`. |
| QUSDC verification | PASS | QIE explorer API reports verified QUSDC source/ABI, `IsProxy=false`. |
| Transfer | PASS | Exact 10,000 base units transferred; no fee. |
| Approve | PASS | Exact allowance 5,000; Approval event decoded. |
| transferFrom | PASS | Exact 5,000 received by recipient; allowance decreased to zero. |
| Policy deployment | PASS | Verified source; address below. |
| Deposit | PASS | Exact 100,000 QUSDC deposited and accounted. |
| Allowed payment | PASS | Exact 1,000 payment; Paid event decoded; request ID marked used. |
| Refused payment | PASS | Broadcast status-0 transaction; cap request ID remained unused; accounting unchanged. |
| Replay protection | PASS | Broadcast status-0 transaction; duplicate request rejected; accounting unchanged. |
| Receipt reliability | PASS | 10/10 successful payments; 10/10 receipts retrieved; 10/10 Paid logs present and decodable. |

## Original read-only preflight evidence

- RPC connectivity: `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`, and `eth_call` succeeded. Observed response latency was approximately 841–1,038 ms on the initial sample.
- Twenty consecutive blocks were sampled. The 19 observed intervals were 3, 4, 3, 4, 3, 4, 4, 3, 4, 3, 4, 4, 3, 4, 3, 4, 4, 3, 4 seconds; average interval `3.632 s`.
- Initial QUSDC reads: `name() = QUSDC`, `symbol() = QUSDC`, `decimals() = 6`, `totalSupply() = 9,171,131,234` base units (`9,171.131234 QUSDC`).
- QUSDC explorer API verification returned verified source and ABI, compiler `v0.8.20+commit.a1b79de6`, optimizer disabled, EVM `berlin`, and `IsProxy=false`.
- The explorer UI’s `Stub Token (goerli)` label remains an unresolved metadata issue. It conflicts with live metadata, verified QUSDC source, matching executable-core recompilation, and both RPC bytecode hashes; no on-chain Goerli substitution was observed.

## Policy contract

Address: `0x6910ac4bAA0A94EC9F28052F971566Dd6B57DdAC`  
Explorer: https://mainnet.qie.digital/address/0x6910ac4bAA0A94EC9F28052F971566Dd6B57DdAC  
Verification: `Pass - Verified`  
Verification GUID: `6910ac4baa0a94ec9f28052f971566dd6b57ddac6afe541e`

Configuration:

- Owner: `0x77918289D518303DDE4f84098B507bdB1dc73E4C`
- Authorized agent: `0xF35F4facb4c9e0ceb836bF350203F67F290F6433`
- QUSDC: `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`
- Per-call cap: `10,000` base units (`0.01 QUSDC`)
- Final deposited balance: `89,000` base units

## Transaction evidence

Explorer URL prefix: `https://mainnet.qie.digital/tx/`

| Test | Transaction hash | Status |
|---|---|---|
| Transfer 0.01 QUSDC | `0x3645c27ad9faf6127725d28af9e97b3ae86e7b5c462d73e4eab0c6b8b7313ce5` | 1 |
| Approve agent 5,000 | `0x92011d831f6d4dc3a6bd85760e16349cfa699d6ebe387039a32b2aa14dce1bae` | 1 |
| transferFrom 5,000 | `0xd8c28cb3c19ed8abad6558c8f5de8cdc5866dc56be30d4166f9802bc055755d1` | 1 |
| Policy deployment | `0xcb451a546b0d29a9a547576c71c8de4fb6b5ca3117ac741784452fc3329002aa` | 1 |
| Deposit approval 100,000 | `0xdf7caa3f8063613e6b3793fe685fc83f80fd1e17b46741bda2d4da2343945516` | 1 |
| Deposit 100,000 | `0x18765debd85bf25c64c5e5645cde7d9a400b769f478dd418faf0a4657e4ca1d8` | 1 |
| Allowed payment 1,000 | `0xed60c5a83098762f3850c2cef91d6fa37b6edc5dd8e42250d03071265a2f3dac` | 1 |
| Cap refusal | `0xf7734fe4350a32496a4df328d2ec30a4e40bd2be31d3b81af0bfac9141522128` | 0 |
| Replay refusal | `0xdd54bd85f9397939c33c3f8d724b72074ea121ea45ca42b231b96de3d651ef61` | 0 |
| Reliability 1 | `0x199aa9b71639dd5a8f09576456c9631dfed5a93919a9610ae3de9b2abd39892a` | 1 |
| Reliability 2 | `0xebba7a1ac5c1b6907173208e5ace965547f8b505e19bc485a511966b83b2fe3b` | 1 |
| Reliability 3 | `0xa8bb764867795953ee4f65a0590dcaec778f92d9e4aa26b83ecc0c8177f6b77e` | 1 |
| Reliability 4 | `0xe939ec3f5a2bf50eeac0b2cd519f48752dbd8a6db9acc05cd13f16a4b1dc6003` | 1 |
| Reliability 5 | `0x05d3481ea2582e4c53b7f27d2e2ce32bf613d8afbfa4f534cb7fc0801b8d989b` | 1 |
| Reliability 6 | `0x8a05699cdfc04f40d0c7d01ae878438f5493208363685afc1924e28439e08382` | 1 |
| Reliability 7 | `0x4bdd9c9a810340ebccb46c819839c9f8dd4222ab2fe044a28917e5b9438d7fa0` | 1 |
| Reliability 8 | `0x850153cbc997e04af9d26230c708eb244bcba2823c086bcd0e0dfe3c657b368d` | 1 |
| Reliability 9 | `0x262de2517a0c49cb3eb0c4fe85b688bf653fc8ff83ab949386f9c6b9f7631ea7` | 1 |
| Reliability 10 | `0xb51b4a8126fbe9a461a6280589a02d1e7469847379bd8d4c7240310c87abe583` | 1 |

Every hash above is directly linkable by appending it to `https://mainnet.qie.digital/tx/`.

Clickable transaction links:

- [Transfer](https://mainnet.qie.digital/tx/0x3645c27ad9faf6127725d28af9e97b3ae86e7b5c462d73e4eab0c6b8b7313ce5)
- [Approve](https://mainnet.qie.digital/tx/0x92011d831f6d4dc3a6bd85760e16349cfa699d6ebe387039a32b2aa14dce1bae)
- [transferFrom](https://mainnet.qie.digital/tx/0xd8c28cb3c19ed8abad6558c8f5de8cdc5866dc56be30d4166f9802bc055755d1)
- [Deployment](https://mainnet.qie.digital/tx/0xcb451a546b0d29a9a547576c71c8de4fb6b5ca3117ac741784452fc3329002aa)
- [Deposit approval](https://mainnet.qie.digital/tx/0xdf7caa3f8063613e6b3793fe685fc83f80fd1e17b46741bda2d4da2343945516)
- [Deposit](https://mainnet.qie.digital/tx/0x18765debd85bf25c64c5e5645cde7d9a400b769f478dd418faf0a4657e4ca1d8)
- [Allowed payment](https://mainnet.qie.digital/tx/0xed60c5a83098762f3850c2cef91d6fa37b6edc5dd8e42250d03071265a2f3dac)
- [Cap refusal](https://mainnet.qie.digital/tx/0xf7734fe4350a32496a4df328d2ec30a4e40bd2be31d3b81af0bfac9141522128)
- [Replay refusal](https://mainnet.qie.digital/tx/0xdd54bd85f9397939c33c3f8d724b72074ea121ea45ca42b231b96de3d651ef61)
- [Reliability 1](https://mainnet.qie.digital/tx/0x199aa9b71639dd5a8f09576456c9631dfed5a93919a9610ae3de9b2abd39892a), [2](https://mainnet.qie.digital/tx/0xebba7a1ac5c1b6907173208e5ace965547f8b505e19bc485a511966b83b2fe3b), [3](https://mainnet.qie.digital/tx/0xa8bb764867795953ee4f65a0590dcaec778f92d9e4aa26b83ecc0c8177f6b77e), [4](https://mainnet.qie.digital/tx/0xe939ec3f5a2bf50eeac0b2cd519f48752dbd8a6db9acc05cd13f16a4b1dc6003), [5](https://mainnet.qie.digital/tx/0x05d3481ea2582e4c53b7f27d2e2ce32bf613d8afbfa4f534cb7fc0801b8d989b)
- [Reliability 6](https://mainnet.qie.digital/tx/0x8a05699cdfc04f40d0c7d01ae878438f5493208363685afc1924e28439e08382), [7](https://mainnet.qie.digital/tx/0x4bdd9c9a810340ebccb46c819839c9f8dd4222ab2fe044a28917e5b9438d7fa0), [8](https://mainnet.qie.digital/tx/0x850153cbc997e04af9d26230c708eb244bcba2823c086bcd0e0dfe3c657b368d), [9](https://mainnet.qie.digital/tx/0x262de2517a0c49cb3eb0c4fe85b688bf653fc8ff83ab949386f9c6b9f7631ea7), [10](https://mainnet.qie.digital/tx/0xb51b4a8126fbe9a461a6280589a02d1e7469847379bd8d4c7240310c87abe583)

### Revert evidence

The existing failed transactions were not resubmitted. Their transaction input, status-0 receipts, and read-only `debug_traceTransaction` results were retrieved.

- Cap violation `0xf7734fe4350a32496a4df328d2ec30a4e40bd2be31d3b81af0bfac9141522128`: trace output `0xf480e285` followed by two 32-byte arguments: `0x4e20` (`20,000` base units = `0.02 QUSDC`) and `0x2710` (`10,000` base units = `0.01 QUSDC`). This is the deployed `CapExceeded(uint256,uint256)` custom error. Receipt status `0x0`, gas used `90,000`, logs `[]`.
- Replay violation `0xdd54bd85f9397939c33c3f8d724b72074ea121ea45ca42b231b96de3d651ef61`: trace output `0x83e0f150` followed by request ID `0x5d0ca1c82ff36b879509ebda93f1b357c08b371053c88edffd8830693f659dc5`. This is the deployed `RequestAlreadyUsed(bytes32)` custom error. Receipt status `0x0`, gas used `90,000`, logs `[]`.

The policy state reads after both failures were unchanged by those calls: the cap request ID remained `false`, the replay request ID remained `true`, and deposited accounting remained `99,000` at the corresponding verification point. No token transfer logs were emitted by either failed transaction. The failed calls therefore consumed gas but did not change QUSDC balances or policy accounting.


## Receipt and event evidence

The `Paid` event topic is:

`0xd73367c4ebfa158722b9021d70c4839ada0c4df8226284f44b29706a1558fe50`

Representative allowed receipt decoded as:

- owner: `0x77918289D518303DDE4f84098B507bdB1dc73E4C`
- agent: `0xF35F4facb4c9e0ceb836bF350203F67F290F6433`
- merchant: `0x000000000000000000000000000000000000bEEF`
- request ID: `0x5d0ca1c82ff36b879509ebda93f1b357c08b371053c88edffd8830693f659dc5`
- amount: `1,000`

All ten reliability receipts had status `1`, gas usage approximately 75,340–75,364, and exactly one `Paid` log. Five broadcast-to-receipt timings were captured directly during the run: 6,341 ms, 6,314 ms, 3,045 ms, 4,464 ms, and 6,403 ms. For that directly measured subset, min/median/max were 3,045 / 6,314 / 6,403 ms. The other five receipts were verified afterward by hash through the RPC/explorer and were not assigned invented historical arrival times. Across all ten receipts: missing `0`, malformed receipts/events `0`, successful `10/10`; historical delay statistics for the five post-run receipts are unavailable and intentionally not estimated.

## Unexpected observations

- RPC gas price varied during execution from approximately 1.0–2.25 gwei.
- The QIE UI still contains `Stub Token (goerli)` despite verified QUSDC source/API data and matching independent compilation. This remains a metadata anomaly.
- The policy verification submission initially returned only an address from `getsourcecode`; after verification submission, `checkverifystatus` returned `Pass - Verified`.

## Remaining risks and limitations

- The QUSDC contract has role-controlled `mint` and `burn` functions through `VAULT_ROLE`; the tested transfer paths were fee-free, but supply-admin privilege remains a separate trust risk.
- Only the tested ERC-20 paths and policy behavior are covered; this is not a full security audit.
- Five historical receipt-arrival timestamps were not preserved in the original run logs, so only the five directly captured delays are reported statistically.

## Technical conclusion

**PASS.** Based on real QIE Mainnet transactions and independently retrievable receipts/events, Meter402 can advance beyond this feasibility gate for the tested ERC-20 and capped/replay-protected policy-payment flow. The explorer label anomaly should remain tracked and clarified by QIE, but it did not affect the verified bytecode or observed transaction behavior.
