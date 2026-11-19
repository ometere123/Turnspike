# M9: deployed TurnpikeAllowance bytecode verification (input to owner decision D2)

Date: 2026-11-19. Read-only against QIE Mainnet, everything else on a local chain or a local fork. Nothing was deployed, signed with a real key, broadcast or paid. **This is a reproducibility and regression check performed for the project, not an external audit, and it does not prove exhaustive behavioural equivalence.**

Contract: `TurnpikeAllowance` at `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c`, QIE Mainnet (chain 1990). Scripts and data are in [`evidence/M9/`](M9/).

## Summary for D2
The deployed contract is a coverage-instrumented build of `contracts/TurnpikeAllowance.sol`. Its exact runtime was reproduced from the verified source. The exact runtime passes the clean build's 15 contract tests and 18 behaviour checks against its real mainnet state on a local fork. Steady-state `pay()` uses 4.5 percent more gas than the clean build. Prepared recommendation: **KEEP**, with the disclosure already in the documentation. The owner's decision (D2) is pending the owner's adoption.

## A. Verified findings (directly measured; reproducible with the commands below)
| # | Finding | Evidence |
|---|---|---|
| V1 | The on-chain runtime is 9,610 bytes, with keccak256 `0x590c9aefe212464ef0e4a20cb55f6308350cb5e49c23a40d2fb8e188776d0e88`. It is identical from `rpc1mainnet.qie.digital` and `rpc2mainnet.qie.digital` (first read at block 12,028,305). | `M9/data/onchain_runtime.hex`, `M9/outputs/reproduce.json` |
| V2 | A clean optimised build of the same source is 3,570 bytes. | `M9/outputs/gas_clean.json` |
| V3 | The explorer records solc `v0.8.20+commit.a1b79de6`, optimizer **disabled** (runs 200 recorded), EVM `berlin`, metadata `useLiteralContent: false`. The constructor arguments are QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` and 5,000,000. | `M9/data/compiler_settings.json` |
| V4 | Compiling the verified sources with those settings yields a 9,610-byte runtime that **equals the on-chain runtime exactly** once the immutables are inserted at their six `immutableReferences` offsets, including the CBOR metadata hash. | `M9/outputs/reproduce.json` (`exactMatchAfterFillingImmutables: true`) |
| V5 | The immutables in the deployed runtime are `token` = QUSDC and `depositCap` = 5,000,000 base units (5 QUSDC). | `M9/outputs/reproduce.json` |
| V6 | The verified ABI has 33 entries and is **identical** to the clean build's ABI: nothing added, nothing removed. No coverage function is externally callable. | `M9/outputs/reproduce.json` (`onlyInVerified: []`, `onlyInClean: []`) |
| V7 | The verified source contains solidity-coverage instrumentation: 133 statement probes, 4 `c_true…` and 2 `c_false…` branch probes, and 6 coverage modifiers. Six probe functions are declared, all `pure`: empty body, `return true`, or `return false`. The verified bundle also includes the test helpers `MockERC20.sol` and `ReentrantToken.sol`. | `M9/data/verified_source.sol.txt`, `M9/data/verified_getsourcecode.json` |
| V8 | After removing the probes, and the empty `else { }` branches added around `if (…) revert …;`, the verified source is token-identical to `contracts/TurnpikeAllowance.sol` (882 tokens each, **parentheses ignored**). | `M9/outputs/reproduce.json` |
| V9 | A Hardhat build of the verified source with the optimizer off reproduces the deployed runtime (immutables zeroed for comparison). **The clean build's 15 contract tests all pass on that build**: SEC-001 isolation, merchant allowlist, valid pay and `Paid`, per-call cap boundary, daily cap and the midnight 2x behaviour, replay, revoke, pause, withdraw ordering, events and views, reentrancy through a malicious token, cross-tenant isolation, SEC-008 no admin surface, and a token-conservation fuzz. | `M9/outputs/instrumented_hardhat_test.txt` |
| V10 | On a local Hardhat fork of QIE Mainnet, with the deployed contract and its real state and with owner and agent impersonated on the fork only, **18 of 18 checks pass**: stranger cannot pay; agent cannot change the owner's caps or withdraw the owner's funds; per-call cap + 1 refused (`CapExceeded`); unlisted merchant refused (`MerchantNotAllowed`); the 19 Nov requestId is used and its replay is refused (`RequestAlreadyUsed`); a valid pay moves exactly 1,000 base units, changes the owner's balance and `spentToday` by exactly 1,000, and emits exactly one `Paid` and one QUSDC `Transfer`; the same requestId again is refused; paused refused (`Paused`); revoked agent refused (`NotOwnerAgent`); the owner withdraws the full balance while paused and revoked; over-withdraw refused. | `M9/outputs/fork-results.json`, `M9/outputs/fork-test-output.txt` |
| V11 | `pay()` gas on a local chain: instrumented 146,243 (first, cold) and 92,147 (steady); clean 142,266 and 88,162. That is +3,985 gas (+4.5 percent) in steady state, about 0.0000045 QIE at 1.125 gwei. The mainnet payment of 19 Nov used 92,159 gas. | `M9/outputs/gas_instrumented.json`, `M9/outputs/gas_clean.json`, `M8_sdk_mainnet.md` |

## B. Inferences (reasoned from the findings, not separately proven)
- **I1.** The probes cannot change contract state or control flow beyond the tested behaviours. They are `pure` (V7) and appear only as standalone calls or as `x && true` / `x || false` operands (V8). This rests on reading the source and on the tests (V9, V10), not on a formal proof.
- **I2.** The deployment most likely reused compilation artifacts left by `hardhat coverage`. The optimizer was off and the test helpers were bundled (V3, V7). The deployment log does not record this directly.
- **I3.** Mainnet transactions before this check (`evidence/M2`, `M4`, `M7`, `M8`) already exercised the deployed contract. They are consistent with V10: an allowed payment, `CapExceeded`, `RequestAlreadyUsed`, and a revoke followed by a refused payment.

## C. Limitations and what is not established
- **Not an audit.** The contract remains unaudited.
- **No exhaustive equivalence.** Behavioural equivalence to the clean build is not fully established. V8 ignores parentheses (the instrumentation's grouping was not machine-checked). The tests cover the documented behaviours, not all inputs.
- **No static analysis of the deployed bytecode.** Slither and the earlier static analysis ran on the clean build. No static analyser was run on the instrumented build.
- **Limited fork scope.** The fork checks ran at a single block (12,028,479 for the committed output; an earlier identical run used 12,028,368), with impersonated accounts and Hardhat's execution environment configured as `shanghai`.
- **Gas measured locally.** The local gas figures come from Hardhat, not QIE, although the steady-state instrumented figure is within 12 gas of the 19 Nov mainnet payment.

## D. Environment
- Node.js 22 (checked with 22.23.3), npm 10+, Git with `git worktree`, Bash (Git Bash on Windows works).
- Repository dependencies (`npm ci --legacy-peer-deps`): Hardhat 2.29.2 and ethers 6.
- solc `0.8.20+commit.a1b79de6` native binary. Hardhat downloads it on first compile and caches it, for example `%LOCALAPPDATA%\hardhat-nodejs\Cache\compilers-v3\windows-amd64\solc-windows-amd64-v0.8.20+commit.a1b79de6.exe` on Windows, or `~/.cache/hardhat-nodejs/compilers-v3/linux-amd64/solc-linux-amd64-v0.8.20+commit.a1b79de6` on Linux.
- Network access to `rpc1mainnet.qie.digital`, `rpc2mainnet.qie.digital` and `mainnet.qie.digital`, for read calls and forking only.
- No keys, wallets, funds or secrets are needed. The fork impersonates the project's public addresses.

## E. Reproduce (from the repository root)
```bash
npm ci --legacy-peer-deps && npx hardhat compile
# 1. Re-fetch the on-chain runtime and verified source (optional; overwrites evidence/M9/data with a fresh read).
node evidence/M9/fetch.mjs
# 2. Exact reproduction, immutables, ABI comparison, probe inventory, source comparison -> evidence/M9/outputs/reproduce.json
SOLC=<path to solc 0.8.20+commit.a1b79de6> node evidence/M9/reproduce.mjs
# 3. Build the deployed (instrumented) source in an isolated worktree and run the clean-build contract suite on it.
bash evidence/M9/prepare-instrumented-worktree.sh ../turnspike-instrumented-check
# 4. Local fork of QIE Mainnet with the deployed contract; run the 18 checks (second terminal for the node).
(cd ../turnspike-instrumented-check && npx hardhat node --fork https://rpc1mainnet.qie.digital --port 8690)
node evidence/M9/fork-test.mjs
# 5. Gas: clean build here, instrumented build in the worktree.
npx hardhat run evidence/M9/gas-compare.ts
(cd ../turnspike-instrumented-check && mkdir -p evidence/M9 && cp ../<repo>/evidence/M9/gas-compare.ts evidence/M9/ && npx hardhat run evidence/M9/gas-compare.ts)
# Clean up the worktree afterwards.
git worktree remove --force ../turnspike-instrumented-check
```
Expected:
- step 2: `"exactMatchAfterFillingImmutables": true`, empty ABI differences, `"tokenIdenticalIgnoringParentheses": true`;
- step 3: `worktree runtime equals deployed runtime (immutables zeroed): true` and `15 passing`;
- step 4: `18/18 checks passed`;
- step 5: `runtimeBytes` 3570 (clean) and 9610 (instrumented).

If `fetch.mjs` is re-run later, block numbers and confirmation counts change; the runtime hash should not.

## F. Files
| Path | Content |
|---|---|
| `M9/data/onchain_runtime.hex` | deployed runtime, as returned by `eth_getCode` |
| `M9/data/verified_getsourcecode.json` | explorer response: verified source, additional sources, settings, ABI (public data) |
| `M9/data/verified_source.sol.txt` | the verified main source (renamed so no tool compiles it as part of the repository) |
| `M9/data/verified_abi.json`, `M9/data/compiler_settings.json` | extracted from the response above |
| `M9/fetch.mjs`, `M9/reproduce.mjs`, `M9/prepare-instrumented-worktree.sh`, `M9/fork-test.mjs`, `M9/gas-compare.ts` | the scripts |
| `M9/outputs/*` | outputs referenced in sections A and B |
