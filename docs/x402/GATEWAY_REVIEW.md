# Independent review of the proposed `TurnspikeX402Gateway` (option E)

Date 2026-11-20. Two independent read-only reviews: standards conformance, and Solidity security. Nothing was implemented or deployed.

## Decision: option E rejected as "genuine compatibility"
The reviewers disagree on safety but agree on the facts:
- The security reviewer judged E buildable with strict conditions.
- The standards reviewer showed it is not genuine standard compatibility.

The owner's requirement (no fake token accounting, no misleading `Transfer` events, nothing that works only because a facilitator fails to check something) decides it.

The standards reviewer's findings against the installed `@x402/evm` 2.31.0 facilitator source and EIP-20/EIP-3009:
- **Not an ERC-20.** `transfer`/`transferFrom`/`approve` revert. EIP-20 makes them mandatory.
- **Synthetic `Transfer` events.** The gateway emits `Transfer(signer, merchant, v)` although no gateway-denominated tokens exist. The real value moves as QUSDC `Transfer(vault, merchant, v)`. Each payment appears twice; indexers would compute phantom or negative balances.
- **Redefined semantics.** `balanceOf(signer)` reports another account's vault balance, and EIP-3009 `from` is not the holder of the funds.
- **Settlement passes only by a facilitator gap.** `verifyEip3009TransferEvent` filters logs to `log.address == asset` and looks for a matching `Transfer`. It never checks that `payTo` received anything. E passes only because the gateway emits that event about itself.
- **No zero-config client.** The `@x402/core` client rejects non-default assets unless the buyer sets `spendControls.allowedAssets` (or disables spend controls). No zero-configuration client pays any custom asset on QIE, E included.

## Alternatives assessed
| Design | Standards-genuine | Owner control | Merchant receives | Vault | Stock client |
|---|---|---|---|---|---|
| E facade over `vault.pay` | **No** | Yes (vault) | QUSDC | kept | needs `allowedAssets`; passes only via the log gap |
| Real "vault credit" ERC-20 | Yes | lost on `transfer`, unless restricted (becomes the wrapper below) | credit token | needs a redeploy or funds leave it | needs `allowedAssets` |
| `pay` to gateway, then forward | No | weakened (owner must allowlist the gateway; per-merchant replay lost) | QUSDC | kept | fails the settle check |
| **wQUSDC: EIP-3009 wrapper token with real balances and an in-token policy hook** | **Yes** | Yes, enforced in the token (allowlist, per-call and daily caps, pause, revoke) on every transfer path | wQUSDC (unwrap 1:1 to QUSDC) | not used: funds move into the wrapper, so policy is duplicated | needs `allowedAssets` |
| Custom x402 scheme over `vault.pay` (current integration) | Yes, as a custom scheme | Yes (vault) | QUSDC | kept | needs the scheme plugin |

**Honest conclusion.** "Real QUSDC to merchants, enforced by the existing vault, paid by unmodified exact clients" is not achievable by any design. The only standards-genuine `exact` path with enforceable owner control is a new policy wrapper token. It means:
- a parallel treasury outside the existing vault;
- policy logic duplicated in a new audited contract;
- merchants paid in wQUSDC;
- agents needing a smart-account (EIP-1271) or agent-held balance;
- buyers allowlisting the asset.

## Security findings kept for any future design (from the Solidity review)
These apply to any contract that chooses which owner pays:
- The owner is derived only from a binding, never from calldata.
- Signer bindings can never be rebound (old authorizations must not follow a signer to a new owner).
- Bind consent is EIP-712 and commits to the owner.
- The nonce is never consumed when settlement reverts.
- Recipients cannot be the zero address, the contract itself or the vault.
- ECDSA only, through OZ `ECDSA` (low-s).
- Effects come before the external call, under `nonReentrant`.
- No `payDirect` pass-through: a second owner account keeps turnspike/1 agents separate.
- Name the contract so it cannot be mistaken for USDC or QUSDC.

Also noted:
- The global `(merchant, requestId)` replay key lets anyone burn a pending requestId for one base unit. This is griefing without theft, already true for turnspike/1, and cannot be fixed without a vault change.

The review's invariants I1–I10 and its 15 adversarial tests are the baseline for any implementation.
