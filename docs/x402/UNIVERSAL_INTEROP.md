# Universal x402 interoperability: can unmodified exact clients pay while the owner keeps on-chain control?

Research, 2026-11-20. Read-only: nothing deployed, nothing sent. **Recommended design requires the owner's approval before any build or deployment.**

## Verified facts
- **Official SDK coverage.** `@x402/evm` 2.31.0 (latest on npm) implements only two exact payloads, EIP-3009 and Permit2. Any other `assetTransferMethod`, including `erc7710`, falls through to EIP-3009. No official SDK implements ERC-7710; the repository mentions it only in the spec.
- **EIP-3009 facilitator path.** It checks the signature (ECDSA, EIP-1271, allowlisted EIP-6492), recipient, window, value and that the asset has code. It simulates and then sends `asset.transferWithAuthorization`. On settle it requires a `Transfer(from, payTo, value)` log from the asset.
- **Permit2 path.** It needs Permit2 and the hard-coded x402 Permit2 proxy (`0x402085c2…0001`). `upto`, `batch-settlement` and `auth-capture` all pull from the payer's own wallet through EIP-3009 or Permit2.
- **Read-only RPC on QIE (chain 1990).**
  - QUSDC has `transfer` and `transferFrom`, but no EIP-3009 and no `permit`, `nonces` or `DOMAIN_SEPARATOR`.
  - `eth_getCode` is empty at:
    - Permit2;
    - the x402 exact and upto proxies;
    - EntryPoint v0.7 and v0.8;
    - the MetaMask Delegation Framework v1.3.0 addresses (DelegationManager, factory, DeleGator implementations, ERC-20 period and amount enforcers), re-verified from MetaMask's published address file;
    - Arachnid's CREATE2 deployer (which the x402 proxies require);
    - the Safe singleton factory, CreateX and Multicall3.

## Candidate architectures
| # | Architecture | Unmodified exact client | Owner control on chain | New infrastructure on 1990 | Redeploy TurnpikeAllowance |
|---|---|---|---|---|---|
| A | Permit2 from the agent's own wallet | yes, once infrastructure exists | **no** (vault bypassed) | CREATE2 deployer, Permit2, proxy | no |
| B | Policy smart account + Permit2 + EIP-1271 | needs a signer adapter | partial (EIP-1271 is view-only; a daily cap only through a once-a-day allowance) | policy account + Permit2 stack | no; funds leave the vault |
| C | ERC-7710 smart account + enforcers | **no** (no SDK client) | yes (stateful enforcers) | delegation framework, EntryPoint | no; vault bypassed |
| D | ERC-7710 routed into `vault.pay` | no; departs from spec §3 | yes | delegation framework + custom delegator | no |
| **E** | **EIP-3009-shaped gateway contract registered as the owner's vault agent** | **yes (plain EOA signer, default method)** | **yes: the existing vault enforces everything** | **one new Turnspike contract, nothing third-party** | **no** |
| F | Wrapped QUSDC with EIP-3009 and built-in policy | yes | re-implemented in the token | new token, parallel treasury | no |

## Recommended: E, `TurnspikeX402Gateway`
**The contract.** An immutable contract (no admin, no upgrade) bound to the existing vault.
- **EIP-3009 surface:** it exposes the interface stock clients and facilitators use: `transferWithAuthorization` (both the v,r,s and `bytes` overloads), `authorizationState`, `cancelAuthorization`, `receiveWithAuthorization` (callable only by `to`), and EIP-712 domain `name`/`version`/`DOMAIN_SEPARATOR`/`eip712Domain` on chain 1990.
- **Not an ERC-20:** `transfer`, `transferFrom` and `approve` revert. `balanceOf(signer)` returns the bound owner's spendable vault balance.
- **Signer binding:** `bindSigner(signer, deadline, sig)` is called by the owner, with the signer's consent signature. `unbind()` can be called by the owner, or by the signer as a kill switch.

**Settlement.** It checks:
1. the time window;
2. that `(from, nonce)` is unused;
3. the signature;
4. the bound owner.

It then calls `vault.pay(owner, to, keccak256(gateway, from, nonce), value)` and emits `Transfer(from, to, value)` plus `X402Paid`. Funds move straight from the vault to the seller, and **the vault enforces** the per-call cap, daily cap, merchant allowlist, pause, revoke and single use.

**Flow.** The seller runs stock `@x402/express` with the exact scheme, advertising `asset = gateway` on `eip155:1990`. A stock client signs EIP-3009, and a stock facilitator (self-hosted, since no public facilitator lists 1990) verifies, simulates and settles. A policy violation reverts in simulation, so nothing is charged.

**Containment.** A gateway bug is bounded, for each owner, by that owner's caps and allowlist. Owners who have not opted in are unaffected.

## Threat model (summary)
- **Compromised agent key:** spending stays within caps and allowlisted merchants. The owner can pause, revoke, unbind or withdraw (withdraw is never blocked). Pre-signed authorizations die when the key is unbound or revoked, because policy is checked at execution.
- **Malicious seller:** can take only the signed value to the signed recipient. Paid-but-not-delivered is inherent to `exact`, and bounded by the per-call cap.
- **Malicious facilitator:** cannot change the amount or recipient. It can delay or withhold settlement.
- **Replay:** `(from, nonce)` in the gateway and `(merchant, requestId)` in the vault. Cross-chain or cross-contract replay fails on the EIP-712 domain.
- **Front-running a header:** the money still goes to `payTo`, but the facilitator reports failure. Sellers reconcile on `Paid` / `X402Paid`.
- **Reorg:** the stock facilitator returns on the first receipt. An in-process facilitator should apply Turnspike's 2 confirmations. Nonces prevent a double spend.
- **Owner key loss:** no rescue (same as the vault today).
- **Accounting:** the facade's `Transfer` events do not change `balanceOf(payTo)`. Explorers may misreport, so sellers reconcile on `Paid`.

## Must be audited
- EIP-712 domain and typehash byte-for-byte against the stock client and facilitator;
- both signature overloads, low-s, EIP-1271;
- binding consent and re-bind races;
- requestId derivation;
- reentrancy and effect ordering around `vault.pay`;
- the `Transfer` log versus the facilitator's event check;
- `balanceOf` semantics;
- interaction with the vault's one-agent-per-owner model;
- a fork test against the real vault bytecode with stock client, seller and facilitator 2.31.0.

## Migration and approvals
- **No redeploy** of TurnpikeAllowance. turnspike/1 and the `turnspike-allowance` scheme are unaffected.
- **Opt-in per owner.** Setting the gateway as the vault agent displaces the owner's EOA agent, so turnspike/1 use needs a separate owner account or a gateway pass-through `payDirect` for the bound signer. With the pass-through, `Paid.agent` becomes the gateway, which matters only for sellers using `allowedPayers` agent binding.
- **Owner approvals needed:**
  - the mainnet gateway deployment;
  - each owner's `setPolicy(gateway, …)`, `setMerchant(payTo)` and `bindSigner`;
  - facilitator gas funding;
  - the exact wording of any interoperability claim, for example "stock exact clients can pay sellers that list the Turnspike gateway asset".

## What remains impossible
- Stock clients cannot pay a seller that lists raw QUSDC while owner control holds.
- The gateway is an EIP-3009-shaped facade, not a real ERC-20, which bends the spec's "native" wording. A facilitator with an asset allowlist will reject it.
- Payers must be enrolled (bound key, funded vault).
- `upto`, `batch-settlement` and `auth-capture` cannot route through the vault.
- EIP-1271 policies are view-only.
