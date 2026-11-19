# M6 TEST-X02: failed-call gas and QUSDC inspection (read-only)

Chain 1990, RPC https://rpc1mainnet.qie.digital. Only `cast tx`, `cast receipt`, `cast call`, `cast run`, `eth_estimateGas`,
`debug_traceTransaction` (callTracer) and `eth_getCode`/`eth_getStorageAt` were used. No transactions were sent.

## A. Reverted transactions show a fixed gasUsed

Observed (VERIFIED, by re-reading txs and receipts):

| Tx | To | gasLimit | receipt gasUsed | status | tracer gasUsed (callTracer) |
|---|---|---|---|---|---|
| 0xf7734fe4...2128 (block 12008163) | proof-of-mechanism 0x6910...DdAC | 180000 | 90000 | 0 | 0x20ec = 8428 |
| 0xdd54bd85...ef61 (block 12008165) | 0x6910...DdAC | 180000 | 90000 | 0 | 0x28db = 10459 |
| 0x8aafc2c6...0656 (block 12009202) | TurnpikeAllowance 0xA2f2...5d9c | 300000 | 150000 | 0 | 0x388b = 14475 |
| 0xde5e3b38...0bf8 (block 12009204) | 0xA2f2...5d9c | 300000 | 150000 | 0 | 0x5ced = 23789 |
| 0x05797724...6641 (block 12009477) | 0xA2f2...5d9c | 300000 | 150000 | 0 | 0x5ced = 23789 |
| 0x07b64fda...2e64 (block 12009201, SUCCESS pay) | 0xA2f2...5d9c | 151228 | 146255 | 1 | 0x7772 = 30578 |

Claims:
1. VERIFIED: in all five reverted txs, receipt gasUsed is exactly 50% of the tx gasLimit (90000/180000, 150000/300000). The "90,000" and
   "150,000" figures are therefore not fixed constants; they track the gas limit the sender set.
2. VERIFIED: the actual execution cost of the reverted calls is far lower. The node's own callTracer reports 8k-24k gas, and `cast run`
   locally replays tx 0x8aafc2c6 with a trace of 14475 gas in the call, matching the tracer (cast's own "Gas used: 36939" includes intrinsic cost).
   So the receipt's gasUsed for failed txs is not the real execution gas.
3. VERIFIED: the revert reasons are correct and match the contract: tx 0x8aafc2c6 returns custom error 0xf480e285 =
   CapExceeded(10000, 10001); a `cast call` at blocks 12009201 and 12009202 gives the same revert. The reverts are correct application
   behaviour, not an out-of-gas or node fault. (Both `eth_call` and `eth_estimateGas` for the call fail with the revert data, so a wallet
   cannot auto-estimate gas for a call that will revert: the sender must set an explicit limit.)
4. VERIFIED: block header gasUsed for block 12009202 is 150000 (the single failed tx), consistent with the receipt, and block gasLimit is 4294967295.
5. VERIFIED (contrast): the successful pay shows receipt gasUsed 146255 against a tracer value of 30578 and a gasLimit of 151228 (an
   estimate), so the receipt figure for even successful txs is not equal to the tracer's number on this chain. I did not establish
   what the receipt number is made of.
6. ASSUMED: the node/receipt layer charges failed transactions 50% of the supplied gas limit (rule fits 5 of 5 samples; success is not 50%).
   Consequence for users: the fee on a reverted tx is about half of (gasLimit x gasPrice) regardless of how early it reverted, so
   keep gasLimit tight (and pre-check policy with eth_call before sending). At gasPrice ~1 gwei, 300000 limit costs 150000 gas = 0.00015 QIE.
7. UNEXPLAINED: why receipts diverge from the tracer's gas (and whether this is a deliberate QIE rule, a consensus-client quirk, or
   an RPC reporting artifact). Whether the 50% charge is actually deducted from the sender balance (versus only reported) was NOT checked
   (needs balance deltas around a failed tx; not done to keep to the read-only constraint and no historic balance diff was examined).
8. UNEXPLAINED: the refund mechanics for a 50%-of-limit rule when the limit is very large (e.g. 4,294,967,295 block limit) were not tested.
   Do not send a failed call with a huge gas limit on mainnet without checking.

## B. QUSDC 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 (read-only)

Runtime bytecode is 6,096 bytes (12195 hex chars incl. 0x). Source is not in this evidence, so the following is from bytecode and calls.
- VERIFIED: name/symbol/decimals/totalSupply respond; decimals = 6; totalSupply = 0x222a45b62 = 9,171,131,234 base units (9,171.13 QUSDC).
- VERIFIED: EIP-1967 implementation slot and admin slot both read zero. No evidence of an EIP-1967 proxy, and no implementation()/upgradeTo
  selectors in the code. ASSUMED non-upgradeable (other proxy patterns not ruled out).
- VERIFIED: the dispatcher contains exactly 19 four-byte selectors (found by scanning `PUSH4 sel; EQ` patterns): supportsInterface 0x01ffc9a7,
  name, approve, totalSupply, transferFrom, getRoleAdmin, grantRole, decimals, renounceRole, mint(address,uint256), balanceOf, hasRole, symbol,
  VAULT_ROLE 0x98c4f1ac, burn(address,uint256) 0x9dc29fac, DEFAULT_ADMIN_ROLE, transfer, revokeRole, allowance.
- VERIFIED: no pause()/unpause()/paused() selectors; `paused()` and `owner()` calls revert (no such function). Common blacklist/freeze selectors
  (blacklist, unBlacklist, addBlackList, isBlacklisted, blacklisted, isBlackListed, freeze, isFrozen, frozen, setBlacklist, blockAddress) are absent
  from the dispatcher, and calls to the getter variants revert.
- VERIFIED: no permit(), increaseAllowance(), or burnFrom selectors.
- VERIFIED: access control is OpenZeppelin AccessControl style: VAULT_ROLE = 0x31e02100...d959; mint and burn(address,uint256) exist (burn takes an
  arbitrary address, which pairs with the role; not confirmed which role gates them, ASSUMED to be VAULT_ROLE per docs/08).
- UNEXPLAINED / NOT CHECKED: transfer/transferFrom may contain internal restrictions (hooks, hidden checks) that do not appear as selectors.
  Not checked: who holds VAULT_ROLE or DEFAULT_ADMIN_ROLE (role members would need event logs `RoleGranted`; hasRole(DEFAULT_ADMIN_ROLE, 0xF35F...6433)
  is false for the project's sender address only). A bytecode scan cannot prove absence of conditional transfer blocks.
- Net for docs/08 trust assumption 1: "pause/blacklist not verified" can be updated to "no pause or blacklist selectors in QUSDC bytecode
  (bytecode-level check only; issuer can still mint/burn via role)".
