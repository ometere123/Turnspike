# Example: x402 v2 agent (`createX402Fetch`) and local two-sided demo

- `src/agent.ts`: `createAgent(config)` builds a `TurnspikeClient` (agent key, payee allowlist, price ceiling, journal) and `createX402Fetch` on top of it. Pass `journalPath` and `proofStorePath` for restart safety.
- `src/local-demo.ts`: the full two-sided flow against the example seller.
- `run-local.mjs`: starts a throwaway Hardhat node, runs the demo, stops the node, exits 0 on success.

Local Hardhat chain only. The only keys used are derived from the public Hardhat test mnemonic. The ERC-20 is `MockERC20`, a labelled test token.

## Run

From the repository root:

```bash
npm install && npx hardhat compile
(cd packages/x402 && npm install)
node examples/x402-agent/run-local.mjs
```

The demo:

1. deploys `TurnpikeAllowance` and `MockERC20`; the owner deposits and sets a per-call cap, a daily cap and the merchant allowlist;
2. starts the example seller (`/v1/report` costs 0.0025);
3. shows the unpaid 402 and its decoded `PAYMENT-REQUIRED`;
4. pays through `createX402Fetch` and prints the decoded `PAYMENT-RESPONSE`;
5. repeats the request (resumed, no new payment) and re-sends the raw `PAYMENT-SIGNATURE` (stored response replayed, no new payment);
6. lowers the owner's per-call cap below the price: refused before paying (`over_per_call_cap`);
7. removes the merchant from the owner's allowlist: refused before paying (`merchant_not_allowed`);
8. pays while the proof cannot reach the seller (`redeem_timeout`, `paid: true`), then a "restarted" agent with the same journal and proof-store files finishes the purchase without paying again.

Set `HARDHAT_PORT` to use a port other than 8662. Set `TURNSPIKE_LOG=on` (any value other than `off`) to see the seller's structured events.

See `docs/x402/GETTING_STARTED.md` for a walkthrough.
