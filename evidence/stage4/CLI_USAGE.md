# Meter402 — CLI and Reproduction Notes

This package records the QIE Mainnet feasibility work. It contains no private keys, keystores, passwords, or wallet credential files.

## Toolchain used

- Windows PowerShell
- Foundry `cast` / `forge` 1.7.1
- Solidity compiler 0.8.20
- Node.js v22.23.3
- npm `solc@0.8.20` used for the independent in-memory recompilation

## Network constants

```text
Chain ID: 1990
RPC 1: https://rpc1mainnet.qie.digital
RPC 2: https://rpc2mainnet.qie.digital
Explorer: https://mainnet.qie.digital
QUSDC: 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5
```

## Read-only verification commands

```powershell
cast chain-id --rpc-url https://rpc1mainnet.qie.digital
cast chain-id --rpc-url https://rpc2mainnet.qie.digital
cast code 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 --rpc-url <RPC> | cast keccak
cast call <QUSDC> 'name()(string)' --rpc-url <RPC>
cast call <QUSDC> 'symbol()(string)' --rpc-url <RPC>
cast call <QUSDC> 'decimals()(uint8)' --rpc-url <RPC>
cast call <QUSDC> 'totalSupply()(uint256)' --rpc-url <RPC>
cast storage <QUSDC> <EIP1967_IMPLEMENTATION_SLOT> --rpc-url <RPC>
cast storage <QUSDC> <EIP1967_ADMIN_SLOT> --rpc-url <RPC>
cast storage <QUSDC> <EIP1967_BEACON_SLOT> --rpc-url <RPC>
```

The explorer verification API used was:

```text
https://mainnet.qie.digital/api?module=contract&action=getsourcecode&address=<ADDRESS>
```

## Compilation

```powershell
forge build
```

The QUSDC independent recompilation used the explorer-returned source in memory with Solidity 0.8.20, optimizer disabled, and EVM `berlin`. The executable core matched after removing the 51-byte Solidity CBOR metadata trailer.

## Policy contract

`src/Meter402Policy.sol` is the minimal policy contract used in the test. It has owner/agent authorization, a per-call cap, deposit accounting, replay protection, custom errors, reentrancy protection, and low-level SafeERC20-compatible return checking.

Constructor parameters used on mainnet:

```text
token: 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5
agent: 0xF35F4facb4c9e0ceb836bF350203F67F290F6433
perCallCap: 10000  # 0.01 QUSDC
```

The deployed contract is recorded in the final report. Its source was submitted with:

```powershell
forge verify-contract --chain-id 1990 --verifier blockscout --verifier-url https://mainnet.qie.digital/api --constructor-args <ABI_ENCODED_ARGS> <POLICY_ADDRESS> src/Meter402Policy.sol:Meter402Policy
```

Verification status was checked with the returned explorer GUID using `checkverifystatus` and returned `Pass - Verified`.

## Existing evidence checks

These are read-only and do not send transactions:

```powershell
./scripts/decode_reverts.ps1
./scripts/verify_receipts.ps1
```

The scripts inspect the already-recorded failed transactions and all ten reliability receipts. They do not contain signing logic.

## Credential handling

The original encrypted `PAPITO` keystore was not used. Two separate local encrypted Foundry keystores were created for the owner and agent wallets. They are intentionally excluded from this archive. A future agent must create or receive its own authorized signer and must never put private keys, passwords, or keystore files in this project or report.

## Evidence files

- `meter402-qie-mainnet-final-report.md`: definitive final result
- `qie-qusdc-verification-stage4-report.md`: QUSDC verification/proxy/anomaly investigation
- `meter402-funding-checkpoint.md`: funding checkpoint and wallet roles
- `qie-mainnet-feasibility-report.md`: initial preflight failure record
- `src/Meter402Policy.sol`: deployed policy source
- `foundry.toml`: Foundry configuration
- `scripts/`: read-only receipt and revert verification scripts
