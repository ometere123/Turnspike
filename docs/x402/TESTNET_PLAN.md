# Turnspike x402: QIE testnet execution plan

Status: PLAN ONLY. Nothing in this file has been executed. No transaction has been signed or broadcast, no faucet request made, no account created.
Prepared: 2026-11-21 (all RPC checks below at about 05:45 UTC that day).
Purpose: close open item O2 in `SECURITY_COMPAT_REPORT.md` ("No QIE testnet or mainnet run of the x402 flow yet").

**No mainnet funds are touched.** Every step runs on QIE testnet (chain 1983). Mainnet (chain 1990), the mainnet vault `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` and mainnet QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` are out of scope. No mainnet key may be loaded on the machine that runs this plan.

---

## 1. Network

| Item | Value | How verified |
|---|---|---|
| Chain ID | **1983** (`0x7bf`) | `eth_chainId` on rpc4testnet and rpc5testnet returned `0x7bf`; matches the official docs |
| Native token | QIE (test) | Official docs only |
| RPC (working) | `https://rpc4testnet.qie.digital/`, `https://rpc5testnet.qie.digital/` | Answered `eth_chainId`, `eth_blockNumber` (`0x96c14c` = 9,879,884, later `0x96c153`), `eth_gasPrice` (`0x7` = 7 wei) |
| RPC (listed, not answering) | `rpc1testnet` (marked "recommend" in the docs), `rpc2testnet`, `rpc3testnet`, `rpc6testnet` `.qie.digital` | No response within 10 s (HTTP 000) on 2026-11-21 |
| Latest block | gas limit `0xffffffff`, baseFee 7 wei, timestamp `0x6b01301d` (current) | `eth_getBlockByNumber latest` |
| Explorer | `https://testnet.qie.digital/` | HTTP 200; its Etherscan-style API `/api?module=block&action=eth_block_number` returned the same head block as the RPC |
| Faucet | `https://www.qie.digital/faucet` | Official docs only; not visited |
| Mainnet (for contrast) | chain 1990 (`0x7c6`), `https://rpc1mainnet.qie.digital` | `eth_chainId` returned `0x7c6` |

Sources:
- QIE docs, "Access Mainnet or Testnet": https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md (chain 1983, RPC list, explorer, faucet), read 2026-11-21.
- QIE docs, faucet: https://docs.qie.digital/getting-started-with-qie-blockchain/4.-get-testnet-coins-faucet.md, read 2026-11-21.
- Read-only JSON-RPC calls listed above, 2026-11-21.

**Warnings and unverified items**
- **Chain ID 1983 collides on public lists.** chainlist.org/chain/1983 and ethereum-lists `eip155-1983.json` describe "Krown Mainnet", not QIE testnet. Never add the network from chainlist; configure the RPC URL by hand and assert `chainId == 1983` against a `*.qie.digital` RPC in every script.
- The "recommended" rpc1testnet was down at check time. Use rpc4 as primary and rpc5 as fallback; re-check all six on the day of execution.
- Whether explorer source verification works on testnet (`/api?module=contract&action=verifysourcecode`) was **not verified** (that call would be a write). Fallback in section 6.
- Faucet amount per request and rate limits: **not verified**.
- Whether the explorer supports `evmVersion: berlin` verification exactly as mainnet did: assumed from mainnet, not verified on testnet.

## 2. Contracts and tokens

### Exists on testnet already (eth_getCode on rpc4testnet, 2026-11-21)

| Address | Meaning on mainnet | Testnet code |
|---|---|---|
| `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | QUSDC | **none (`0x`)** |
| `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` | TurnpikeAllowance | **none (`0x`)** |
| `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Permit2 (canonical) | none (`0x`) |

No QIE docs page read lists a testnet QUSDC or USDC address. **Conclusion: no testnet QUSDC is known; a MockERC20 test token must be deployed.** If the owner later supplies an official testnet QUSDC address, check it with `eth_getCode`, `decimals()` (must be 6) and `symbol()` via `eth_call` before using it instead of the mock, and skip T1/T3.

### Must be deployed

| Contract | Source | Compiler | Constructor args |
|---|---|---|---|
| `MockERC20` ("Mock QUSDC", "mQUSDC", 6 decimals, open `mint`) | `contracts/test-helpers/MockERC20.sol` | as below | none |
| `TurnpikeAllowance` | `contracts/TurnpikeAllowance.sol`, same commit and bytes as the mainnet-verified source (`evidence/M9/data/verified_source.sol.txt`) | solc 0.8.20, optimizer on, runs 200, evmVersion berlin (`hardhat.config.ts`, `evidence/M9/data/compiler_settings.json`) | `token_ = <MockERC20 address>`, `depositCap_ = 5_000_000` (5.0 mQUSDC) |

Before deploying, rebuild and confirm the TurnpikeAllowance runtime bytecode (minus immutables) equals the mainnet runtime in `evidence/M9/data/onchain_runtime.hex`, using `evidence/M9/reproduce.mjs`. Record the git commit hash.

Address placeholders filled in during execution: `TOKEN=`, `VAULT=`, `OWNER=`, `AGENT=`, `MERCHANT=`, `STRANGER=` (a second merchant address that is never allowlisted; address only, no key needed).

## 3. Signed transactions, in order

Gas: the network reports a 7 wei gas price. Estimates below come from local runs (`evidence/M9/outputs/gas_clean.json`: `pay` 142,266 first call, 88,162 after) and typical OpenZeppelin costs; each one is replaced by `eth_estimateGas` immediately before signing and the script refuses to sign if the estimate exceeds the "max" column. Reverting transactions are **not broadcast**: negative cases are checked with `eth_call`/`eth_estimateGas` (which return the custom error) unless noted.

| # | Signer | Target | Function and args | Gas est. | Max gas |
|---|---|---|---|---|---|
| T1 | OWNER (deployer) | create | deploy `MockERC20()` | ~750k | 1.5M |
| T2 | OWNER | create | deploy `TurnpikeAllowance(TOKEN, 5_000_000)` | ~900k | 1.8M |
| T3 | OWNER | TOKEN | `mint(OWNER, 10_000_000)` (10.0 mQUSDC) | ~70k | 150k |
| T4 | OWNER | TOKEN | `approve(VAULT, 1_000_000)` (exact deposit amount, not unlimited) | ~47k | 100k |
| T5 | OWNER | VAULT | `deposit(1_000_000)` (1.0) | ~75k | 150k |
| T6 | OWNER | VAULT | `setPolicy(AGENT, 10_000, 100_000)` (per call 0.01, daily 0.1) | ~70k | 150k |
| T7 | OWNER | VAULT | `setMerchant(MERCHANT, true)` | ~47k | 100k |
| — | — | — | Fund AGENT with native test QIE for gas (plain transfer from OWNER) | 21k | 21k |
| P1 happy path | AGENT (via `examples/x402-agent`) | VAULT | `pay(OWNER, MERCHANT, <requestId from 402>, 2_500)`; seller returns 200 with PAYMENT-RESPONSE | ~142k | 250k |
| P2 cap violation | AGENT | VAULT | `pay(OWNER, MERCHANT, rid, 20_000)` (> 10_000). Client must refuse before signing; also `eth_call` must revert `CapExceeded(10000, 20000)`. **Not broadcast** | — | — |
| P3 non-allowlisted merchant | AGENT | VAULT | seller quotes payTo STRANGER. Client refuses (payee not on list); `eth_call pay(OWNER, STRANGER, rid, 2_500)` reverts `MerchantNotAllowed`. **Not broadcast** | — | — |
| P4a paused | OWNER | VAULT | `setPaused(true)` | ~47k | 100k |
| P4b | AGENT | VAULT | `eth_call pay(...)` reverts `Paused`; client reports paused. **Not broadcast** | — | — |
| P4c | OWNER | VAULT | `setPaused(false)` | ~30k | 100k |
| P5 replay | AGENT | VAULT | resend the P1 `PAYMENT-SIGNATURE` to the seller: must be refused, handler not run twice. `eth_call pay(OWNER, MERCHANT, <P1 requestId>, 2_500)` reverts `RequestAlreadyUsed`. **Not broadcast** | — | — |
| P6 late payment | AGENT | VAULT | seller started with a short payment deadline (for example 20 s); agent (test hook) waits past the deadline then pays `pay(OWNER, MERCHANT, rid, 2_500)`. Tx succeeds on chain; seller must record `REJECTED / PAID_LATE` and not deliver (open item O7) | ~88k | 250k |
| P6b | MERCHANT | TOKEN | manual refund `transfer(OWNER, 2_500)` per the PAID_LATE procedure (optional; tests the documented refund) | ~35k | 100k |
| P7a revoked | OWNER | VAULT | `revokeAgent()` | ~30k | 100k |
| P7b | AGENT | VAULT | `eth_call pay(...)` reverts `NotOwnerAgent`. **Not broadcast** | — | — |
| C1 cleanup | OWNER | VAULT | `withdraw(<account(OWNER).balance>)` (expected 1_000_000 − 2_500 − 2_500 = 995_000) | ~45k | 100k |
| C2 | OWNER | VAULT | `setMerchant(MERCHANT, false)`; `setPaused(true)` | ~30k each | 100k each |

Total broadcast: about 17 transactions, about 2.6M gas expected, 4.5M gas at the per-tx maxima.

Optional (owner decides): broadcast one deliberately reverting `pay` (P2) to get an explorer-visible failed transaction. Default is no.

## 4. Funds

- Testnet native QIE needed: at 7 wei/gas, 4.5M gas costs 0.0000000315 QIE. Even at 1,000x today's price (7 gwei) it is 0.0315 QIE.
- **Hard cap: 1.0 test QIE spent in total across all accounts.** Request at most what the faucet gives once for OWNER; OWNER sends AGENT 0.1 test QIE and MERCHANT 0.05 (only if P6b is run). Scripts abort if the gas price exceeds 100 gwei or if cumulative spend would pass 1.0 test QIE.
- Test token: 10.0 mQUSDC minted (no value), at most 1.0 deposited, at most 0.05 paid out (daily cap 0.1).
- **No mainnet funds, mainnet keys or mainnet contracts are touched.** The faucet request is a manual step by the owner, not by an automated agent.

## 5. Accounts and keys

| Role | Key | Holder | Use |
|---|---|---|---|
| OWNER (deployer and vault owner) | fresh, testnet-only | Project owner, on their machine | T1–T7, P4, P7a, C1–C2, gas funding |
| AGENT | fresh, testnet-only | Agent process; loaded by `packages/cli` / `examples/x402-agent` from an encrypted keystore | P1, P6 only |
| MERCHANT | fresh, testnet-only (address only unless P6b) | Seller operator (the owner) | Receives payments |
| STRANGER | address only, no key | — | Negative test P3 |

Rules:
- Generate each key fresh for this run. Never reuse a mainnet key or the public Hardhat mnemonic.
- Store each key only as an encrypted JSON keystore (ethers/geth/Foundry format, as the CLI already accepts via `--keystore`). The password comes from `TURNSPIKE_KEYSTORE_PASSWORD` or a no-echo prompt and is never written to disk, logs, shell history or the repo.
- Never print a private key or mnemonic. Logs show addresses only.
- Keystores live outside the repository (for example `%USERPROFILE%\turnspike-testnet-keys\`) and are covered by `.gitignore` patterns anyway; check `git status` is clean of them before any commit.
- `deploy-local.mjs` refuses any chain other than 31337 and must stay that way. A separate `deploy-testnet` script must assert `chainId == 1983`, refuse 1990, and load OWNER from a keystore.
- Afterwards: once results are recorded, either destroy the keystores (secure delete) or archive them encrypted offline, labelled "QIE testnet 1983 only, Turnspike run 2026-xx-xx". Owner chooses at checkpoint A6. Addresses stay in the evidence record.

## 6. Success and failure criteria

Each step records in `evidence/TESTNET/` (new folder): tx hash, block number, gasUsed, status, explorer link `https://testnet.qie.digital/tx/<hash>`, and for `eth_call` checks the decoded revert error.

| Step | Pass | Fail (stop and go to section 7) |
|---|---|---|
| Pre-flight | `eth_chainId == 0x7bf` on the chosen RPC; rebuild matches mainnet runtime | Any other chain ID; bytecode mismatch |
| T1, T2 | status 1; `eth_getCode` non-empty; `token()` == TOKEN, `depositCap()` == 5_000_000 | Revert, or code at an unexpected address |
| Source verification | Explorer shows TurnpikeAllowance "verified" with compiler 0.8.20, runs 200, berlin; record the page link and the explorer's getsourcecode output. Fallback if testnet verification is unavailable: record the local runtime-bytecode match (M9 method) and state verification was not possible | Explorer verification reports mismatch |
| T3–T5 | `balanceOf(OWNER)` = 9_000_000; `account(OWNER).balance` = 1_000_000; `Deposited` event | Different balances |
| T6, T7 | `account(OWNER)` agent/perCallCap/dailyCap match; `allowedMerchant(OWNER, MERCHANT)` true | Mismatch |
| P1 | HTTP 402 then 200; `Paid` event amount 2_500; MERCHANT token balance +2_500; PAYMENT-RESPONSE `network` = `eip155:1983`, `payer` = OWNER, `transaction` = the tx hash | Delivery without payment; wrong payer or network |
| P2, P3, P4b, P5, P7b | Client refuses before signing **and** `eth_call` returns the exact custom error; no tx broadcast; balances unchanged; seller handler not run | Any broadcast, balance change, or delivery |
| P4a/c, P7a | `PausedSet` / `AgentRevoked` events, view state matches | Mismatch |
| P6 | Tx status 1; seller records `PAID_LATE`; no delivery; listed in paid-not-delivered output | Delivery after the deadline |
| C1–C2 | `account(OWNER).balance` = 0; OWNER token balance restored minus payments; merchant disallowed; paused | Non-zero vault balance |
| Budget | Total native spend ≤ 1.0 test QIE (sum of gasUsed × price) | Cap exceeded: abort |

The run passes only if every row passes and the evidence folder is complete.

## 7. Cleanup and incident recovery

Normal cleanup: C1 withdraw the full balance (withdraw is never blocked by pause or revoke), C2 disallow the merchant and pause, P7a revoke has already run. Leave the contracts in place (no self-destruct; they hold no funds).

| Incident | Action |
|---|---|
| Stuck nonce (pending tx not mined) | Do not send new txs. Check `eth_getTransactionCount(addr, "pending")` vs `"latest"` on two RPCs. Re-send a replacement with the **same nonce** and gas price raised ≥ 10% (a 0-value self-transfer to cancel, or the same call). Never skip a nonce. |
| RPC outage | Switch rpc4 ↔ rpc5 (then re-test 1, 2, 3, 6). Re-assert chain ID 1983 after any switch. Before re-sending, look up the last tx hash on the explorer to avoid duplicates. If no RPC answers, pause the run; nothing is at risk since state is on chain. |
| Wrong-address deploy (wrong token, wrong cap, wrong chain) | Do not use it. Record the address as "abandoned" in evidence. If it already holds a deposit, `withdraw` it out. Redeploy with corrected args at checkpoint A2 again. If anything was deployed to chain 1990 by mistake: stop, notify the owner, do not interact with it further. |
| Leaked key (any role) | OWNER leak: `withdraw` the full balance and `setPaused(true)` from OWNER at once, then abandon the account. AGENT leak: OWNER calls `revokeAgent()` (and `setPaused(true)`); max loss is bounded by the per-call/daily caps of a valueless test token. MERCHANT leak: `setMerchant(MERCHANT, false)`. In every case: rotate to new fresh keys, check that no mainnet key could have been exposed on the same machine, and record the incident. |
| Unexpected success of a negative test | Stop, `setPaused(true)`, withdraw, and file it as a security finding before any further step. |

## 8. Owner approval checkpoints

The owner signs off (name, date, written "approved") at each point; nothing proceeds past a checkpoint without it.

- **A0 Plan approval:** this document, the 1.0 test QIE cap, and the chain 1983 RPC/explorer choice.
- **A1 Keys:** three fresh testnet-only keystores created by the owner, addresses recorded, passwords held by the owner only. Owner requests faucet funds for OWNER manually.
- **A2 Pre-deploy:** git commit, bytecode match to mainnet runtime, constructor args (`TOKEN`, `5_000_000`), `eth_estimateGas` results. Approves T1–T2.
- **A3 Setup:** deployed addresses and source-verification result. Approves T3–T7 and the AGENT gas transfer.
- **A4 x402 scenarios:** approves P1–P7 (and states whether P2 may be broadcast as a visible revert, and whether P6b refund runs).
- **A5 Cleanup:** approves C1–C2 after checking the final `account(OWNER)` view.
- **A6 Close-out:** evidence folder reviewed; key disposition (destroy or archive) decided; O2 in `SECURITY_COMPAT_REPORT.md` may be updated.
