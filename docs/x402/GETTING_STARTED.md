# Getting started: a local paid x402 v2 call in 15 minutes

This walkthrough goes from a fresh clone to a two-sided paid call over x402 v2 on a **local Hardhat chain**, using the real `TurnpikeAllowance` contract and the custom scheme `turnspike-allowance`. It then shows an owner cap refusal, a merchant-allowlist refusal and a safe retry after a failure. Nothing touches a public network, and no real key is used: every key comes from the public Hardhat test mnemonic, and the token is `MockERC20`, a labelled test token.

Before you start, know the limits: this is x402 v2 through a registered custom scheme. Only clients that register `turnspike-allowance` (such as `createX402Fetch` here) can pay. Unmodified `exact` clients cannot. See `SCHEME.md` section 8.

## 1. Prerequisites (2 minutes)

- Node.js 20 or later, git.
- Free local ports: 8662 (Hardhat; change with `HARDHAT_PORT`) and one ephemeral port for the seller.

## 2. Install and compile (5 minutes)

```bash
git clone <this repository> turnspike && cd turnspike   # the repository root; called `turnspike` throughout
git checkout feature/x402-v2-integration
npm install                          # Hardhat and the contract toolchain
npx hardhat compile                  # artifacts/contracts/TurnpikeAllowance.sol, test-helpers/MockERC20.sol
(cd packages/x402 && npm install)    # @x402/core, @x402/express, @x402/fetch 2.31.0, tsx
```

The examples run the TypeScript sources of `packages/middleware`, `packages/client` and `packages/x402` directly through `tsx`; the path mappings are in `examples/x402-agent/tsconfig.json`. Nothing is published or built.

## 3. Run the two-sided demo (3 minutes)

```bash
node examples/x402-agent/run-local.mjs
```

The demo seller is configured as in production: it listens first, then passes its real origin (`http://127.0.0.1:<port>`) as `publicOrigin` (`x402.publicOrigin`), so no warning is printed. Without a public origin, x402 refuses to start in production (any `NODE_ENV` other than `development` or `test`, including unset) and runs a loud development fallback only with `NODE_ENV=development` or `test` (or `x402.production: false`) (see `packages/x402/README.md`, Canonical resource URL).

It starts a Hardhat node, deploys, starts the seller from `examples/x402-seller`, runs `examples/x402-agent/src/local-demo.ts`, stops the node and exits 0. Output from a real run (addresses are deterministic on a fresh node; hashes, ports and times vary):

```text
1. local chain 31337: TurnpikeAllowance 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512, MockERC20 (test token) 0x5FbDB2315678afecb367f032d93F642f64180aa3
   owner deposited 1.0000, agent per-call cap 0.0100, daily cap 0.1000, merchant 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC allowlisted
2. seller listening on http://127.0.0.1:52448; GET /v1/report costs 0.0025 (scheme turnspike-allowance)
3. unpaid request -> 402; PAYMENT-REQUIRED: x402Version 2, scheme turnspike-allowance, network eip155:31337, amount 2500, payTo 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
4. paid call -> 200 {"report":"example data","generatedAt":"2026-11-21T01:38:36.524Z"}
   PAYMENT-RESPONSE: {"success":true,"transaction":"0x79464e1aa90377f158e76b90366b8bf15c55db10f03a9a08a0edc9f6843dcf29","network":"eip155:31337","payer":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}
   owner charged 0.0025
5. replay: same request -> resumed=true, same body=true; raw PAYMENT-SIGNATURE re-sent -> 200, stored response replayed; owner still charged 0.0025 in total
6. owner cap 0.0010 < price 0.0025 -> refused before paying: error=over_per_call_cap, paid=false, maybePaid=false
7. merchant removed from the owner's allowlist -> refused before paying: error=merchant_not_allowed, paid=false, maybePaid=false
8. paid, then the proof could not be delivered -> error=redeem_timeout, paid=true, maybePaid=false
   restarted agent: 1 unfinished purchase(s) in the journal; same request -> 200, resumed=true; owner charged 0.0025 once
X402 LOCAL DEMO OK
```

## 4. What happened

**Setup (step 1).** The owner (Hardhat account 0) deposits test tokens into `TurnpikeAllowance`, authorises the agent (account 1) with a per-call cap of 0.01 and a daily cap of 0.1, and allowlists the merchant (account 2, an address only). In production the owner does this from the web console with a wallet.

**Seller (steps 2 and 3).** `examples/x402-seller/src/seller.ts` creates the Turnspike middleware with `x402: true` and mounts `x402Seller(mw)`. An unpaid request gets a 402 whose JSON body is the `turnspike/1` challenge and whose `PAYMENT-REQUIRED` header is the same signed challenge as an x402 v2 `PaymentRequired` with one `turnspike-allowance` requirement. You can inspect any such endpoint without paying:

```bash
# x402 probe is unreleased (not in the published CLI 0.1.1, and `turnspike` is not on PATH here): run it from source.
cd packages/cli && npm install
node ../x402/node_modules/tsx/dist/cli.mjs src/bin.ts x402 probe http://127.0.0.1:<port>/v1/report --config turnspike.config.json
# or: npm run build && node dist/bin.js x402 probe <url> --config turnspike.config.json
```

The CLI configuration defaults to QIE Mainnet, so without a local configuration the probe reports `network DOES NOT MATCH your config, payee NOT on your payee list` and exits 3. For the local chain, write `packages/cli/turnspike.config.json` (addresses are the deterministic ones of a fresh node; set the origin to your seller's):

```json
{
  "network": { "name": "Local Hardhat", "chainId": 31337, "rpcUrls": ["http://127.0.0.1:8545"],
               "contract": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", "token": "0x5FbDB2315678afecb367f032d93F642f64180aa3" },
  "payees": [{ "origin": "http://127.0.0.1:8080", "merchant": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" }],
  "maxPrice": "0.01"
}
```

The demo's seller stops with the demo, so probe the standalone seller (`examples/x402-seller/README.md`, port 8080 on a node at 8545); the probe then prints `policy  network matches, payee trusted, price within your max 0.01` and exits 0. It never pays.

**Paid call (step 4).** `createX402Fetch` (in `examples/x402-agent/src/agent.ts`) gets the 402, checks the payee, chain, token, price and the owner's on-chain limits, sends `TurnpikeAllowance.pay` from the agent key, waits for confirmations and sends `PAYMENT-SIGNATURE`. The seller's in-process facilitator binds the proof to the challenge (no broadcast), the handler runs once, and `PAYMENT-RESPONSE` names the existing transaction and the owner as `payer`.

**Replay (step 5).** The same request again derives the same purchase key, so the agent re-presents its recorded proof instead of paying. Sending the raw `PAYMENT-SIGNATURE` again returns the stored response. The owner is charged once. (With `replayWindowSeconds: 86400`, as the example sets, a proof stops working after a day and answers 410.)

**Owner cap refusal (step 6).** The owner lowers the per-call cap to 0.001. The agent reads the account before sending anything and refuses with `over_per_call_cap`, `paid: false`. No transaction is sent; if one were, the contract would revert it.

**Merchant-allowlist refusal (step 7).** The owner removes the merchant. The agent refuses with `merchant_not_allowed`, `paid: false`.

**Safe retry and recovery (step 8).** The demo pays while every request carrying `PAYMENT-SIGNATURE` fails in transport. After its retry budget the agent returns `redeem_timeout` with `paid: true`: the money moved, nothing was delivered. A new agent built on the same `FileJournal` and `FileProofStore` files (as after a process restart) finds one unfinished purchase and, for the same request, re-presents the recorded proof: 200, `resumed: true`, charged once. A naive retry never pays twice. For startup recovery in your own agent, call `client.recoverPending()` first (see `packages/x402/README.md`, Recovery).

## 5. Next steps

- Read the result semantics: `paid` / `maybePaid` table in `packages/x402/README.md`.
- Configure a real seller: `x402.publicOrigin` (plus `x402.basePath` behind a prefix-stripping proxy; required and enforced at start-up in production, O4; `Host`, `X-Forwarded-*` and `trust proxy` are never used to derive it), `guard: true`, `replayWindowSeconds: 86400`.
- Read the normative scheme: `docs/x402/SCHEME.md`.
- Run the package tests: `cd packages/x402 && npm test` (local chain only).

Before any use with real funds, read the limitations: the contract is unaudited, the bytecode deployed on QIE Mainnet is a coverage-instrumented build (`docs/OWNER_DECISIONS.md` D2), and the scheme is custom, not universal.
