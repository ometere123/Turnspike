# @turnspike/client

Agent-side client for Turnspike APIs. It turns a Turnspike HTTP 402 into a payment on QIE, but only inside a spending policy you define, and it survives restarts without paying twice. Not published to npm yet: build from this repository and depend on it with `"@turnspike/client": "file:../../packages/client"`.

```ts
import { TurnspikeClient, FileJournal, QIE_MAINNET, parseUnits } from "@turnspike/client";

const client = new TurnspikeClient({
  signer,                                   // the AGENT signer: keystore wallet, KMS or remote signer. Never the owner key.
  owner: "0xOwner...",                      // whose allowance account pays
  network: QIE_MAINNET,                     // trusted chain, settlement contract and QUSDC
  policy: {
    payees: [{ origin: "https://api.example.com", merchant: "0xMerchant..." }], // nobody else is ever paid
    maxPriceBase: parseUnits("0.005"),      // hard ceiling per request
  },
  approve: (quote) => quote.gasCostWei < 10n ** 15n, // your own rule, called before every payment
  journal: new FileJournal(".turnspike/journal.json"),
});

const r = await client.fetch("https://api.example.com/v1/report/7", {}, { idempotencyKey: "report-7" });
if (r.ok && r.kind === "paid") console.log(await r.response.json(), r.payment.explorerUrl);
else if (!r.ok && r.paid) await client.resume("report-7"); // paid, not yet delivered: collect later
```

## What happens on `fetch`
1. The request is sent. A non-402 answer is returned as `{ kind: "free" }`.
2. The 402 body is validated (`protocol` must be `turnspike/1` when present).
3. Trust checks, all local: the request origin **and** the merchant named in the challenge must be a listed payee; chain id, contract and token must match the trusted network; the price must be within every ceiling; the challenge must not be about to expire.
4. Chain checks: the signer is the owner's authorized agent, the account is not paused, the merchant is on the owner's on-chain allowlist, the request id is unused, the price fits the per-call cap, today's remaining cap and the balance, and the agent has enough QIE for gas (estimate x gas price, plus `minGasReserveWei`, under `maxGasCostWei`).
5. `approve(quote)` is called. With `dryRun: true` the quote is returned and nothing is sent.
6. The nonce and head block are journaled, then `pay(owner, merchant, requestId, amount)` is broadcast and the hash journaled.
7. After `confirmations` the proof `X-Payment: base64({requestId, txHash, sig})` is presented, retrying 202, 429 and 5xx answers with backoff until `redeemTimeoutMs`.

Every refusal in steps 2 to 5 costs nothing. **A payment that reached the chain cannot be reversed because a later HTTP step failed.** The result then has `paid: true`; keep the key and call `resume(key)`.

## Restart safety
The journal records each purchase by `idempotencyKey`. `fetch` with a known key, or `resume(key)`, continues from the recorded state: it redeems a confirmed payment, waits for a broadcast one, and for a crash between broadcast and saving the hash it checks `isUsed` on the contract and finds the transaction from the `Paid` log. The contract also refuses a second payment of the same request id. Journals hold the challenge `sig` (the secret half of the proof): protect the file, or supply your own `Journal` backed by your secret store. `FileJournal` is for one process; share an agent key across processes only with a shared journal.

## Results
`{ ok: true, kind: "free" | "paid" | "dry_run" }` or `{ ok: false, error, message, paid, payment?, quote? }` where `error` is one of `invalid_challenge`, `unsupported_protocol`, `untrusted_destination`, `wrong_network`, `price_above_max`, `challenge_expired`, `not_authorized_agent`, `paused`, `merchant_not_allowed`, `over_per_call_cap`, `over_daily_cap`, `insufficient_balance`, `insufficient_gas`, `gas_cost_above_max`, `declined`, `already_paid`, `tx_reverted`, `tx_timeout`, `rpc_unavailable`, `gateway_unavailable`, `redeem_rejected`, `redeem_timeout`, `request_failed`, `payment_pending`.

## Cost on QIE (measured)
One payment used 92,159 gas, 0.000104 QIE at 1.125 gwei, on 2026-11-19 (`evidence/M8_sdk_mainnet.md`). Gas price varies; the client always uses a live estimate.
