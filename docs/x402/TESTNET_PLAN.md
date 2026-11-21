# Turnspike x402: QIE testnet execution plan

**STATUS: NOT YET APPROVED. PLAN ONLY.** Nothing in this file has been executed. No keystore has been created, no account funded, no faucet request made, nothing deployed, signed or broadcast. The only actions taken so far are read-only JSON-RPC calls (section 1) and local compiles.
Prepared: 2026-11-21. RPC checks recorded at the timestamps given in section 1.
Purpose: close open item O2 in `SECURITY_COMPAT_REPORT.md` ("No QIE testnet or mainnet run of the x402 flow yet").
Evidence basis: branch `feature/x402-v2-integration`, tested commit `406998a` plus the review-correction commit that follows it (the PR's newest commit; its CI result is shown on the PR, not claimed here). GitHub CI passed on both runs (push and pull_request) at `406998a`, every job including the regression gate.

---

## 0. Checkpoint A0: what the owner is asked to approve (one page)

**Approving A0 authorises exactly this, and nothing else:**

1. Creating three fresh, testnet-only encrypted keystores (OWNER, AGENT, MERCHANT) outside the repository, by the owner, on the owner's machine.
2. Requesting testnet-only native QIE from the official faucet for OWNER, manually, by the owner.
3. Deploying two contracts to QIE testnet (chain 1983): a **TEST TOKEN (mock)** named "Turnspike Test USD" / `tTUSD` (6 decimals, open `mint`, no value), and the **clean optimised** `TurnpikeAllowance`. The testnet `TurnpikeAllowance` is **not byte-identical** to the existing mainnet runtime (section 2).
4. Signing and broadcasting the transactions listed in section 3 (about 17), within the per-transaction gas maxima and the 1.0 test QIE total cap of section 4.
5. Running the scripted negative cases through `eth_call` only (nothing broadcast unless the owner opts in at A4).

**Approving A0 explicitly does NOT authorise:**

- any mainnet (chain 1990) action: no mainnet write, no mainnet key on the machine, no use of the mainnet vault `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` or mainnet QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`;
- spending more than 1.0 test QIE in total, depositing more than 1.0 tTUSD, or paying out more than 0.05 tTUSD;
- reusing any existing key, the public Hardhat mnemonic, or a mainnet key;
- touching or redeploying the existing mainnet contract (owner decision D2 stays open and is unaffected);
- treating a pass as evidence about the real mainnet QUSDC (see the table below).

**What a pass demonstrates, and what it does not:**

| Demonstrates | Does NOT demonstrate |
|---|---|
| The x402 v2 `turnspike-allowance` workflow (402, on-chain `pay`, settle, 200, replay refusal, late payment, cap, allowlist, pause, revoke) running end to end against a real QIE testnet RPC, with the clean optimised `TurnpikeAllowance` and a mock test token | The behaviour of the real mainnet QUSDC (its transfer semantics, admin or blacklist features were not exercised). The token is a TEST TOKEN (mock) |
| The scripts' chain and genesis pinning, gas budgeting and keystore handling on a real network | That the deployed mainnet runtime behaves like the clean build. Mainnet is the 9,610-byte coverage-instrumented build; testnet gets the 3,570-byte clean build. They are **not byte-identical**. Mainnet is covered separately by `evidence/M9_deployed_bytecode_verification.md`, which this run neither replaces nor extends |
| That the clean build's runtime on testnet equals the locally compiled runtime (gate G3) | An audit, mainnet readiness, or behaviour under production load or against hostile RPCs |

**Checkpoints, in order** (each needs the owner's written "approved", name and date; nothing proceeds past one without it):

| # | Name | Approves |
|---|---|---|
| A0 | Plan approval | This section and the whole plan. Status: **NOT YET APPROVED** |
| A1 | Keys | Three keystores created, addresses recorded, OWNER funded from the faucet by the owner |
| A2 | Pre-deploy | Gates G1 to G5 recorded and green; deploy T1 and T2 |
| A3 | Setup | Deployed addresses, G3 and G6 results; T3 to T7 and the AGENT gas transfer |
| A4 | x402 scenarios | P1 to P7; whether P2 is broadcast; whether the P6b refund runs |
| A5 | Cleanup | C1 and C2 after checking the final `account(OWNER)` view |
| A6 | Close-out | Evidence reviewed, key disposition, O2 update |

**Nothing has been created, funded, signed or broadcast.** No run output, address or transaction hash from a testnet run appears anywhere in this document.

**No mainnet funds are touched.** Every step runs on QIE testnet (chain 1983). No mainnet key may be loaded on the machine that runs this plan.

---

## 1. Network

| Item | Value | How verified |
|---|---|---|
| Chain ID | **1983** (`0x7bf`) | `eth_chainId` on rpc4testnet and rpc5testnet both returned `0x7bf` (2026-11-21 about 19:24 UTC); matches the official docs |
| Genesis pin | block `0x0` hash `0x24c52787b369eff58e08c7c2109b8d3171131dc35c5b92d32a754ea479cd3c8c` | Identical on both RPCs, see "RPC agreement" below |
| Native token | QIE (test) | Official docs only |
| RPC (working) | `https://rpc4testnet.qie.digital/`, `https://rpc5testnet.qie.digital/` | Answered `eth_chainId`, `eth_blockNumber` (head 9,891,199 at 19:24 UTC), `eth_gasPrice` (`0x7` = 7 wei earlier the same day) |
| RPC (listed, not answering) | `rpc1testnet` (marked "recommend" in the docs), `rpc2testnet`, `rpc3testnet`, `rpc6testnet` `.qie.digital` | No response within 10 s (HTTP 000) on 2026-11-21 |
| Latest block | gas limit `0xffffffff`, baseFee 7 wei | `eth_getBlockByNumber latest` |
| Explorer | `https://testnet.qie.digital/` | HTTP 200; its Etherscan-style API `/api?module=block&action=eth_block_number` returned the same head block as the RPC |
| Faucet | `https://www.qie.digital/faucet` | Official docs only; not visited |
| Mainnet (for contrast) | chain 1990 (`0x7c6`), `https://rpc1mainnet.qie.digital` | `eth_chainId` returned `0x7c6` |

Sources:
- QIE docs, "Access Mainnet or Testnet": https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md (chain 1983, RPC list, explorer, faucet), read 2026-11-21.
- QIE docs, faucet: https://docs.qie.digital/getting-started-with-qie-blockchain/4.-get-testnet-coins-faucet.md, read 2026-11-21.
- Read-only JSON-RPC calls listed above and below, 2026-11-21.

### RPC agreement (rpc4testnet vs rpc5testnet), read-only, 2026-11-21 about 19:24 UTC

**Result: the two RPCs agree on every compared value. No disagreement was found.** If the re-check on the day of execution (gate G2) shows any difference, the plan is **BLOCKED** until the owner decides which endpoint, if either, to trust.

| Check | rpc4testnet = rpc5testnet |
|---|---|
| `eth_chainId` | `0x7bf` (1983) on both |
| `eth_blockNumber` | both 9,891,199 at the time of the query |
| Genesis (`eth_getBlockByNumber "0x0"`) | hash `0x24c52787b369eff58e08c7c2109b8d3171131dc35c5b92d32a754ea479cd3c8c`, parentHash `0x0000000000000000000000000000000000000000000000000000000000000000`, stateRoot `0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, timestamp `0x68580349` (1750598473, 2025-06-22 UTC) |
| Block N = 9,891,179 (lower head minus 20) | hash `0x0ed86ca8f91596d3d595d4e67742f7b5f6b93566d66886096f2922abe1762bdc`, parentHash `0xef70471fd57658d78fffc8a498a828f49365cfa24518bdb1d995be85c44128d9`, stateRoot `0x5fda4c101a27dd75a527ba19f633b65ce83e5dfcb40405cc2f1c5c33c96cde40`, timestamp 1795288957 |
| Block N-1 = 9,891,178 | hash `0xef70471fd57658d78fffc8a498a828f49365cfa24518bdb1d995be85c44128d9`, parentHash `0x841bd31bbc9142f92fc8abcf5c1c6b61514600a2390e173bb5beb4e7c8e54a33`, stateRoot `0x352fd21317daf2e1376ee6af44f7b8e1d234332aa982a8fcd338210c9fe008d4` |
| Mid block 4,945,589 | hash `0xeddee1361bdf3793eef823f4c24a862593e803f401a79cbe31d6be3a27e491bf`, parentHash `0x25cea22f0bcaaf22809de4493cb49d51fb173e5384b5a88f14c42bb453cad478`, stateRoot `0xf78a86532b4df01f60e30c22d2081da77a6b8bc69c3b8927d0333234a13fe4b3` |

What this does and does not prove:
- Identical block hashes and parent links at three heights and an identical genesis show the two endpoints serve the same chain history **at the time of the check**. It does not show they are independent (they may sit behind one operator), and it does not prove the chain is the "official" QIE testnet beyond the docs and the explorer head matching.
- **Quirk:** `eth_getBlockByNumber "0x0"` returns a block whose `number` field is `0x1`, identical to the answer for `"0x1"`, with a zero parentHash. Block `0x2` has parentHash `0x24c52787...3c8c`, so this block is the root of the served history. The "genesis" pin is therefore the hash returned for `"0x0"`.
- That first block's stateRoot is the SHA-256 of the empty string, not the Ethereum empty-trie root, so this is not a stock geth chain. Do not assume stock tooling behaviour (for example `eth_getProof`).

**Pinned genesis hash for all scripts: `0x24c52787b369eff58e08c7c2109b8d3171131dc35c5b92d32a754ea479cd3c8c`** (the `hash` returned for `eth_getBlockByNumber("0x0")`).

**Warnings and unverified items**
- **Chain ID 1983 collides on public lists.** chainlist.org/chain/1983 and ethereum-lists `eip155-1983.json` describe "Krown Mainnet", not QIE testnet. **Chain ID alone is therefore not sufficient to identify the network.** Never add the network from chainlist; configure the RPC URL by hand, and every script must assert **both** `chainId == 1983` **and** the pinned genesis hash above, on every RPC it uses, before it signs anything (gate G1).
- The "recommended" rpc1testnet was down at check time. Use rpc4 as primary and rpc5 as fallback; re-check all six on the day of execution.
- Whether explorer source verification works on testnet (`/api?module=contract&action=verifysourcecode`) was **not verified** (that call would be a write). Fallback in section 6.
- Faucet amount per request and rate limits: **not verified**.
- Whether the explorer supports `evmVersion: berlin` verification on testnet: assumed from mainnet, not verified.

## 2. Contracts and tokens

### Exists on testnet already (eth_getCode on rpc4testnet, 2026-11-21)

| Address | Meaning on mainnet | Testnet code |
|---|---|---|
| `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | QUSDC | **none (`0x`)** |
| `0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c` | TurnpikeAllowance | **none (`0x`)** |
| `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Permit2 (canonical) | none (`0x`) |

No QIE docs page read lists a testnet QUSDC or USDC address. **Conclusion: no testnet QUSDC is known; a TEST TOKEN (mock) must be deployed.** If the owner later supplies an official testnet QUSDC address, check it with `eth_getCode`, `decimals()` (must be 6) and `symbol()` via `eth_call` before using it instead of the mock, and skip T1 and T3.

### Which build is deployed (decision recorded 2026-11-21)

- **Mainnet today** is the **9,610-byte coverage-instrumented build, optimizer disabled** (solc `0.8.20+commit.a1b79de6`, `evmVersion berlin`, optimizer off; `evidence/M9/data/compiler_settings.json`, `evidence/M9/data/onchain_runtime.hex`, keccak256 of the runtime `0x590c9aefe212464ef0e4a20cb55f6308350cb5e49c23a40d2fb8e188776d0e88`). Evidence M9 reproduces that exact runtime separately.
- **The clean optimised build** (`hardhat.config.ts`: solc 0.8.20, optimizer on, runs 200, `evmVersion berlin`) has a **3,570-byte** runtime. Both sizes were re-measured on 2026-11-21 by compiling locally and reading the artifact `deployedBytecode` length, and by reading `onchain_runtime.hex`.
- **Owner decision for the functional x402 testnet run: deploy the CLEAN OPTIMISED contract.** It is **NOT byte-identical to the existing mainnet runtime**, and this run makes no claim that it is. Mainnet-runtime parity is not required for what this run tests (the x402 workflow), because the x402 packages call the contract only through its ABI, and the ABI was compared in M9. Exact-runtime verification of the mainnet contract stays the separate evidence M9.

### Must be deployed

| Contract | Source | Compiler | Constructor args |
|---|---|---|---|
| **TEST TOKEN (mock)**: name "Turnspike Test USD", symbol `tTUSD`, 6 decimals, open `mint`. Deliberately **not** called QUSDC | A new test-helper contract (for example `contracts/test-helpers/TurnspikeTestUSD.sol`, a copy of `MockERC20.sol` with the name and symbol changed) to be added **before A2**; it does not exist yet. `MockERC20` itself ("Mock QUSDC", "mQUSDC") is **not** to be deployed to testnet, so that nothing on the network is labelled QUSDC | solc 0.8.20, optimizer on, runs 200, evmVersion berlin | none |
| `TurnpikeAllowance` (clean optimised) | `contracts/TurnpikeAllowance.sol` at the recorded git commit (gate G3) | solc 0.8.20, optimizer on, runs 200, evmVersion berlin (`hardhat.config.ts`) | `token_ = <tTUSD address>`, `depositCap_ = 5_000_000` (5.0 tTUSD) |

Address placeholders filled in during execution: `TOKEN=` (the tTUSD contract), `VAULT=`, `OWNER=`, `AGENT=`, `MERCHANT=`, `STRANGER=` (a second merchant address that is never allowlisted; address only, no key needed).

## 3. Signed transactions, in order

Gas: the network reports a 7 wei gas price. Estimates come from local runs (`evidence/M9/outputs/gas_clean.json`: `pay` 142,266 first call, 88,162 after) and typical OpenZeppelin costs; each is replaced by `eth_estimateGas` immediately before signing and the script refuses to sign if the estimate exceeds the "max" column. Reverting transactions are **not broadcast**: negative cases are checked with `eth_call` and `eth_estimateGas` (which return the custom error) unless noted.

| # | Signer | Target | Function and args | Gas est. | Max gas |
|---|---|---|---|---|---|
| T1 | OWNER (deployer) | create | deploy the tTUSD test token (`TOKEN`) | ~750k | 1.5M |
| T2 | OWNER | create | deploy `TurnpikeAllowance(TOKEN, 5_000_000)` (clean optimised) | ~900k | 1.8M |
| T3 | OWNER | TOKEN | `mint(OWNER, 10_000_000)` (10.0 tTUSD) | ~70k | 150k |
| T4 | OWNER | TOKEN | `approve(VAULT, 1_000_000)` (exact deposit amount, not unlimited) | ~47k | 100k |
| T5 | OWNER | VAULT | `deposit(1_000_000)` (1.0) | ~75k | 150k |
| T6 | OWNER | VAULT | `setPolicy(AGENT, 10_000, 100_000)` (per call 0.01, daily 0.1) | ~70k | 150k |
| T7 | OWNER | VAULT | `setMerchant(MERCHANT, true)` | ~47k | 100k |
| - | - | - | Fund AGENT with native test QIE for gas (plain transfer from OWNER) | 21k | 21k |
| P1 happy path | AGENT (via `examples/x402-agent`) | VAULT | `pay(OWNER, MERCHANT, <requestId from 402>, 2_500)`; seller returns 200 with PAYMENT-RESPONSE | ~142k | 250k |
| P2 cap violation | AGENT | VAULT | `pay(OWNER, MERCHANT, rid, 20_000)` (> 10_000). Client must refuse before signing; also `eth_call` must revert `CapExceeded(10000, 20000)`. **Not broadcast** | - | - |
| P3 non-allowlisted merchant | AGENT | VAULT | seller quotes payTo STRANGER. Client refuses (payee not on list); `eth_call pay(OWNER, STRANGER, rid, 2_500)` reverts `MerchantNotAllowed`. **Not broadcast** | - | - |
| P4a paused | OWNER | VAULT | `setPaused(true)` | ~47k | 100k |
| P4b | AGENT | VAULT | `eth_call pay(...)` reverts `Paused`; client reports paused. **Not broadcast** | - | - |
| P4c | OWNER | VAULT | `setPaused(false)` | ~30k | 100k |
| P5 replay | AGENT | VAULT | resend the P1 `PAYMENT-SIGNATURE` to the seller: must be refused, handler not run twice. `eth_call pay(OWNER, MERCHANT, <P1 requestId>, 2_500)` reverts `RequestAlreadyUsed`. **Not broadcast** | - | - |
| P6 late payment | AGENT | VAULT | seller started with a short payment deadline (for example 20 s); agent (test hook) waits past the deadline then pays `pay(OWNER, MERCHANT, rid, 2_500)`. Tx succeeds on chain; seller must record `REJECTED / PAID_LATE` and not deliver (open item O7) | ~88k | 250k |
| P6b | MERCHANT | TOKEN | manual refund `transfer(OWNER, 2_500)` per the PAID_LATE procedure (optional; tests the documented refund) | ~35k | 100k |
| P7a revoked | OWNER | VAULT | `revokeAgent()` | ~30k | 100k |
| P7b | AGENT | VAULT | `eth_call pay(...)` reverts `NotOwnerAgent`. **Not broadcast** | - | - |
| C1 cleanup | OWNER | VAULT | `withdraw(<account(OWNER).balance>)` (expected 1_000_000 - 2_500 - 2_500 = 995_000) | ~45k | 100k |
| C2 | OWNER | VAULT | `setMerchant(MERCHANT, false)`; `setPaused(true)` | ~30k each | 100k each |

Total broadcast: about 17 transactions, about 2.6M gas expected, 4.5M gas at the per-tx maxima. The gas figures come from local runs of the clean build, which is the bytecode being deployed; the instrumented mainnet build costs about 4.5 percent more (M9) and is not what runs here.

Optional (owner decides): broadcast one deliberately reverting `pay` (P2) to get an explorer-visible failed transaction. Default is no.

## 4. Funds

- Testnet native QIE needed: at 7 wei/gas, 4.5M gas costs 0.0000000315 QIE. Even at 1,000x today's price (7 gwei) it is 0.0315 QIE.
- **Hard cap: 1.0 test QIE spent in total across all accounts.** Request at most what the faucet gives once for OWNER; OWNER sends AGENT 0.1 test QIE and MERCHANT 0.05 (only if P6b is run). Scripts abort if the gas price exceeds 100 gwei or if cumulative spend would pass 1.0 test QIE.
- Test token (tTUSD, no value): 10.0 minted, at most 1.0 deposited, at most 0.05 paid out (daily cap 0.1).
- **No mainnet funds, mainnet keys or mainnet contracts are touched.** The faucet request is a manual step by the owner, not by an automated agent.

## 5. Accounts and keys

| Role | Key | Holder | Use |
|---|---|---|---|
| OWNER (deployer and vault owner) | fresh, testnet-only | Project owner, on their machine | T1 to T7, P4, P7a, C1 to C2, gas funding |
| AGENT | fresh, testnet-only | Agent process; loaded by `packages/cli` / `examples/x402-agent` from an encrypted keystore | P1, P6 only |
| MERCHANT | fresh, testnet-only (address only unless P6b) | Seller operator (the owner) | Receives payments |
| STRANGER | address only, no key | - | Negative test P3 |

Rules:
- Generate each key fresh for this run. Never reuse a mainnet key or the public Hardhat mnemonic.
- Store each key only as an encrypted JSON keystore (ethers/geth/Foundry format, as the CLI already accepts via `--keystore`). The password comes from `TURNSPIKE_KEYSTORE_PASSWORD` or a no-echo prompt and is never written to disk, logs, shell history or the repo.
- Never print a private key or mnemonic. Logs show addresses only.
- Keystores live outside the repository (for example `%USERPROFILE%\turnspike-testnet-keys\`) and are covered by `.gitignore` patterns anyway; check `git status` is clean of them before any commit.
- `deploy-local.mjs` refuses any chain other than 31337 and must stay that way. A separate `deploy-testnet` script must assert `chainId == 1983` **and the pinned genesis hash**, refuse 1990, and load OWNER from a keystore.
- Afterwards: once results are recorded, either destroy the keystores (secure delete) or archive them encrypted offline, labelled "QIE testnet 1983 only, Turnspike run 2026-xx-xx". Owner chooses at checkpoint A6. Addresses stay in the evidence record.

## 6. Preflight gates, success and failure criteria

### Preflight gates (all must be green and recorded in `evidence/TESTNET/preflight.json` before A2)

| Gate | Requirement |
|---|---|
| G1 chain and genesis pin | Every script (deploy, agent, seller, checks) asserts, on every RPC it uses and before signing anything, **both** `eth_chainId == 0x7bf` **and** `eth_getBlockByNumber("0x0").hash == 0x24c52787b369eff58e08c7c2109b8d3171131dc35c5b92d32a754ea479cd3c8c`. It refuses chain 1990. Any mismatch aborts |
| G2 RPC agreement on the day | Re-run the section 1 comparison (chainId, genesis, a recent block N, N-1 and a mid block) for rpc4testnet and rpc5testnet. Any difference blocks the run and is reported to the owner |
| G3 clean-build record and runtime equality | **Before deploy**, record for the exact clean build that will be deployed: git commit; compiler version (`0.8.20+commit.a1b79de6`, from build-info `solcLongVersion`); settings (optimizer enabled, runs 200, evmVersion berlin, the full settings JSON); runtime size in bytes; sha256 and keccak256 of the runtime `deployedBytecode`. On 2026-11-21 at the tested tree the clean `TurnpikeAllowance` runtime is 3,570 bytes, sha256 `04c9d1a236cb618d86c40a7d0db12084b6d925214d43ed00eff1e2c9544eef5a`, keccak256 `0x5e32f75502dd97bfcf9d698d5ab381fe6d53ef73e6698010da8ebe1514649cb1` (re-record at A2: any source change changes the hash). Do the same for the tTUSD token. **After deploy**, `eth_getCode(VAULT)` must equal the locally compiled `deployedBytecode` once the immutable slots are masked using the build-info `immutableReferences` (the on-chain code holds the `token` and `depositCap` values there); the length must equal the recorded size. Same for TOKEN. Mismatch fails the run. There is **no** gate requiring the testnet runtime to match the mainnet runtime, because it cannot (9,610 versus 3,570 bytes) and the owner decided not to |
| G4 token labelling | The deployed token reports `symbol() == "tTUSD"`, `name() == "Turnspike Test USD"`, `decimals() == 6`, and nothing in scripts, logs or evidence calls it QUSDC |
| G5 keys and repo hygiene | Three fresh keystores outside the repo; `git status` clean of keystores and passwords; no mainnet key on the machine |
| G6 explorer verification (A3) | See the source-verification row below; recorded, not required to pass |

### Per-step criteria

Each step records in `evidence/TESTNET/` (new folder): tx hash, block number, gasUsed, status, explorer link `https://testnet.qie.digital/tx/<hash>`, and for `eth_call` checks the decoded revert error.

| Step | Pass | Fail (stop and go to section 7) |
|---|---|---|
| Pre-flight | G1 to G5 green and recorded | Any other chain ID or genesis hash; RPC disagreement; deployed runtime differs from the locally compiled clean build |
| T1, T2 | status 1; `eth_getCode` non-empty; G3 equality; `token()` == TOKEN, `depositCap()` == 5_000_000 | Revert, code at an unexpected address, or code not equal to the recorded build |
| Source verification | Explorer shows TurnpikeAllowance "verified" with compiler 0.8.20, optimizer on, runs 200, berlin (these are the clean-build settings, **not** the mainnet verification's optimizer-off settings); record the page link and the explorer's getsourcecode output. Fallback if testnet verification is unavailable: record the G3 local runtime match and state verification was not possible | Explorer verification reports mismatch |
| T3 to T5 | `balanceOf(OWNER)` = 9_000_000; `account(OWNER).balance` = 1_000_000; `Deposited` event | Different balances |
| T6, T7 | `account(OWNER)` agent/perCallCap/dailyCap match; `allowedMerchant(OWNER, MERCHANT)` true | Mismatch |
| P1 | HTTP 402 then 200; `Paid` event amount 2_500; MERCHANT token balance +2_500; PAYMENT-RESPONSE `network` = `eip155:1983`, `payer` = OWNER, `transaction` = the tx hash | Delivery without payment; wrong payer or network |
| P2, P3, P4b, P5, P7b | Client refuses before signing **and** `eth_call` returns the exact custom error; no tx broadcast; balances unchanged; seller handler not run | Any broadcast, balance change, or delivery |
| P4a/c, P7a | `PausedSet` / `AgentRevoked` events, view state matches | Mismatch |
| P6 | Tx status 1; seller records `PAID_LATE`; no delivery; listed in paid-not-delivered output | Delivery after the deadline |
| C1 to C2 | `account(OWNER).balance` = 0; OWNER token balance restored minus payments; merchant disallowed; paused | Non-zero vault balance |
| Budget | Total native spend <= 1.0 test QIE (sum of gasUsed x price) | Cap exceeded: abort |

The run passes only if every row passes and the evidence folder is complete. **A pass is evidence for the x402 workflow on QIE testnet with a mock test token and the clean optimised contract. It is not evidence about the real mainnet QUSDC and not evidence about the deployed mainnet bytecode** (see section 0).

## 7. Cleanup and incident recovery

Normal cleanup: C1 withdraw the full balance (withdraw is never blocked by pause or revoke), C2 disallow the merchant and pause, P7a revoke has already run. Leave the contracts in place (no self-destruct; they hold no funds).

| Incident | Action |
|---|---|
| Stuck nonce (pending tx not mined) | Do not send new txs. Check `eth_getTransactionCount(addr, "pending")` vs `"latest"` on two RPCs. Re-send a replacement with the **same nonce** and gas price raised >= 10% (a 0-value self-transfer to cancel, or the same call). Never skip a nonce. |
| RPC outage or disagreement | Switch rpc4 and rpc5 only after re-asserting chain ID 1983 **and the genesis pin** (G1) on the new endpoint. Before re-sending, look up the last tx hash on the explorer to avoid duplicates. If the two endpoints ever disagree on a block hash, stop and report. If no RPC answers, pause the run; nothing is at risk since state is on chain. |
| Wrong-address deploy (wrong token, wrong cap, wrong chain) | Do not use it. Record the address as "abandoned" in evidence. If it already holds a deposit, `withdraw` it out. Redeploy with corrected args at checkpoint A2 again. If anything was deployed to chain 1990 by mistake: stop, notify the owner, do not interact with it further. |
| Leaked key (any role) | OWNER leak: `withdraw` the full balance and `setPaused(true)` from OWNER at once, then abandon the account. AGENT leak: OWNER calls `revokeAgent()` (and `setPaused(true)`); max loss is bounded by the per-call and daily caps of a valueless test token. MERCHANT leak: `setMerchant(MERCHANT, false)`. In every case: rotate to new fresh keys, check that no mainnet key could have been exposed on the same machine, and record the incident. |
| Unexpected success of a negative test | Stop, `setPaused(true)`, withdraw, and file it as a security finding before any further step. |

## 8. Owner approval checkpoints (detail)

The list and the one-page A0 summary are in section 0. In detail:

- **A0 Plan approval:** section 0, this document, the 1.0 test QIE cap, the chain 1983 RPC and explorer choice, and the clean-optimised (non-mainnet-identical) deploy decision. **NOT YET APPROVED.**
- **A1 Keys:** three fresh testnet-only keystores created by the owner, addresses recorded, passwords held by the owner only. Owner requests faucet funds for OWNER manually.
- **A2 Pre-deploy:** gates G1 to G5 (including the G3 build record), constructor args (`TOKEN`, `5_000_000`), `eth_estimateGas` results. Approves T1 and T2.
- **A3 Setup:** deployed addresses, G3 post-deploy equality and source-verification result. Approves T3 to T7 and the AGENT gas transfer.
- **A4 x402 scenarios:** approves P1 to P7 (and states whether P2 may be broadcast as a visible revert, and whether the P6b refund runs).
- **A5 Cleanup:** approves C1 to C2 after checking the final `account(OWNER)` view.
- **A6 Close-out:** evidence folder reviewed; key disposition (destroy or archive) decided; O2 in `SECURITY_COMPAT_REPORT.md` may be updated.
