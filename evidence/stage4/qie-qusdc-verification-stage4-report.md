# Meter402 — Stage 4 QUSDC Contract Verification Report

Date: 2026-11-19  
Scope: Read-only investigation only  
Address: `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`

## Findings

### Explorer API

The QIE explorer exposes a Blockscout-compatible endpoint:

`https://mainnet.qie.digital/api?module=contract&action=getsourcecode&address=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`

Returned result:

- `status`: `1`
- `Address`: `0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5`
- `ContractName`: `QUSDC`
- `IsProxy`: `false`
- `SourceCode`: present, 34,401 characters
- `ABI`: present, 33 entries
- Compiler: `v0.8.20+commit.a1b79de6`
- Optimization: `false`
- EVM version: `berlin`
- Source reports `QUSDC` / `QUSDC`, `decimals() = 6`, and the constructor grants `DEFAULT_ADMIN_ROLE` to `msg.sender`.

The ABI includes standard ERC-20 methods/events plus `mint`, `burn`, `grantRole`, `revokeRole`, `hasRole`, `getRoleAdmin`, `DEFAULT_ADMIN_ROLE`, and `VAULT_ROLE`.

### Proxy inspection

Foundry `cast storage` was used against the live QIE RPC:

RPC: `https://rpc1mainnet.qie.digital`  
Chain ID: `1990`

| Slot | Value | Interpretation |
|---|---|---|
| EIP-1967 implementation `0x360894...382BBC` | `0x00` | No implementation address |
| EIP-1967 admin `0xB53127...5D6103` | `0x00` | No proxy admin address |
| EIP-1967 beacon `0xA3F0AD...3E7A6F` | `0x00` | No beacon address |

The explorer also reports `IsProxy=false`. The address is therefore not behaving as an EIP-1967 proxy, and there is no implementation address to retrieve.

### Deployed code

Current deployed runtime bytecode was retrieved with `cast code`.

- Keccak-256 of returned runtime bytecode: `0x86c3675b798fef82ca801afa2f12eae09dfaa68772389ef78fa33cf18a649510`
- `eth_getCode` confirms non-empty deployed code.

The explorer’s creation transaction is available through:

`https://mainnet.qie.digital/api?module=account&action=txlist&address=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5&page=1&offset=10&sort=asc`

Creation evidence returned:

- Deployment transaction: `0x847cf63ebb99609570f4d975660e93892b6adb82561059db40223b36fd810e07`
- Deployment block: `5244996`
- Deployer/creator: `0xe1acec6312eb701d4a14de700ccec8dee17a8d28`
- Receipt status: `1`

### Source behavior and control surface

The returned verified source is an OpenZeppelin-style ERC-20 plus `AccessControl`:

- `transfer` and `transferFrom` call the normal ERC-20 balance/allowance paths.
- `_update` performs exact balance subtraction/addition and emits standard `Transfer` events.
- No `Pausable`, blacklist, whitelist, or transfer-tax implementation was found in the source.
- `mint(address,uint256)` and `burn(address,uint256)` are restricted to `VAULT_ROLE`.
- `DEFAULT_ADMIN_ROLE` can grant/revoke roles; the source makes that role self-administered.
- This is an administrative supply-control privilege, not a transfer fee.

The first role-grant transaction in the explorer’s transaction list is:

- `0x53c918d3921741820dd50352cd93e553f71395c470d01b2e08113bc5ec334239`
- From: `0xe1acec6312eb701d4a14de700ccec8dee17a8d28`
- Input grants `VAULT_ROLE` (`0x31e0210044b4f6757ce6aa31f9c6e8d4896d24a755014887391a926c5224d959`) to `0xdc20f1fee9e03184ddabcce96f01e3c570e43d45`.

This identifies the deployer and a verified role-grant event. It does not establish that either address belongs to the QIE team.

### Sourcify

No usable Sourcify full-match or partial-match metadata was returned for chain ID `1990` and this address. The attempted repository paths did not return contract metadata; the public Sourcify check endpoint did not provide a machine-readable match result. Therefore the positive verification evidence currently comes from the QIE explorer API, not Sourcify.

### “Stub Token (goerli)” discrepancy

Established facts:

1. Live QIE RPC metadata returns `QUSDC` / `QUSDC` with 6 decimals.
2. Live bytecode is non-empty and non-proxy.
3. QIE explorer API returns verified source named `QUSDC`, ABI, compiler settings, and `IsProxy=false`.
4. The explorer’s rendered address page still contains the text `Stub Token`.

Conclusion: the label is inconsistent with the explorer API, verified source, and live contract metadata. The evidence supports a stale or incorrectly attached explorer display label; it does **not** support calling the deployed contract a Goerli stub. The exact provenance of the UI label is not exposed by the read-only API, so the label’s database history remains unresolved.

## Bytecode/source comparison status

The explorer supplies compiler version, optimization setting, EVM version, source, ABI, and the exact deployed runtime hash above. The source has no immutable variables. A clean-room recompilation was not performed because the explorer returns flattened source without a reproducible project layout/import manifest; therefore byte-for-byte independent reproduction is not claimed here. The explorer’s own verification response is positive (`status=1`) and is the authoritative verification result currently available from QIE.

## Resolution and remaining issue

The original “source cannot be established” blocker is resolved through the QIE explorer API: QUSDC is reported as a verified, non-proxy contract with source and ABI.

The remaining issue is the contradictory UI label `Stub Token (goerli)`. Before advancing the original feasibility gate, obtain either a QIE explorer correction/confirmation or an authoritative QIE team response explaining that label. No funding, wallet unlock, deployment, or write transaction was performed.

## Technical request to QIE

Please confirm/correct the explorer record for `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` on QIE Mainnet (chain ID 1990). The API reports a verified, non-proxy `QUSDC` contract compiled with Solidity `v0.8.20+commit.a1b79de6`, optimizer disabled, EVM `berlin`, but the rendered page displays `Stub Token (goerli)`. Please confirm the deployed runtime code, explain or remove the stale label, and provide the canonical verified source/ABI record. If the record is intended to be a proxy, provide the implementation address and proxy configuration; current EIP-1967 implementation, admin, and beacon slots are all zero.
