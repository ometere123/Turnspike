# Developer onboarding: sell one paid endpoint and buy it with an agent

**Status, stated plainly: no external developer has completed this guide yet.** It was written from the repository and checked by the project team only. If you are the first, please report every place it failed.

Everything below is either clearly labelled **local chain** (free, a test token, no real money) or **mainnet** (real QUSDC and QIE gas; use small amounts, the contract is unaudited and caps deposits at 5 QUSDC per account).

Packages (all published at 0.1.0 as of 2026-11-19; check with `npm view <name> version`): `@turnspike-qie/middleware`, `@turnspike-qie/client`, `@turnspike-qie/cli`. The scope is `@turnspike-qie`.

## 0. Fastest path: the local two-sided run (local chain, free)
```powershell
git clone https://github.com/ometere123/Turnspike
cd Turnspike
npm ci --legacy-peer-deps
npx hardhat compile
node examples/end-to-end/run.mjs
```
Expected last line: `END-TO-END OK`. It deploys the contract and a **mock test token on a local Hardhat chain**, runs a seller and an agent, pays, replays, and shows two refusals. It is not a mainnet transaction.

## 1. Seller: protect an endpoint
```powershell
npm install @turnspike-qie/middleware express
```
```ts
import express from "express";
import { turnspike } from "@turnspike-qie/middleware";

const paid = turnspike({
  rpcUrls: ["https://rpc1mainnet.qie.digital", "https://rpc2mainnet.qie.digital"], chainId: 1990,
  contract: "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c",   // TurnpikeAllowance (deployed name is historical)
  token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",      // QUSDC, 6 decimals
  merchant: process.env.MERCHANT_ADDRESS!,                   // address that receives payment
  hmacSecrets: [process.env.HMAC_SECRET!],                   // 32+ random bytes; keep secret
  dbPath: "./turnspike.sqlite",                              // persistent disk
  prices: { "/quote": 1000 },                                // 0.001 QUSDC
});
const app = express();
app.use("/v1", paid);
app.get("/v1/quote", (_q, r) => r.json({ quote: "hello" }));
setInterval(() => paid.reconcile().then(() => paid.purge()), 15 * 60_000);
app.listen(3000);
```
Check: `curl -i localhost:3000/v1/quote` returns `402` with a JSON challenge (`requestId`, `sig`, `priceBase`, `merchant`, `expiresAt`). Handlers must be idempotent (they can run again after a crash). Full options and limits: `packages/middleware/README.md`.

## 2. Owner: set the rules (once per agent)
Using the web console at https://turnspike-qie.vercel.app/app with your own wallet, on **QIE Mainnet (1990)**:
1. Deposit QUSDC into your account (cap 5 QUSDC).
2. Authorize the agent address with a per-call cap and a daily cap.
3. Allowlist your seller's merchant address.
You can pause, revoke or withdraw at any time. The owner key never goes on the agent or the seller.

## 3. Agent: create a key and fund gas
Create a separate agent key (an encrypted keystore, for example with Foundry `cast wallet new` and a password) and send it a little QIE for gas (one payment used about 0.0001 QIE).

Steps 4a and 4b use `QIE_MAINNET`: even against a seller on `localhost`, the payment is a **real mainnet payment** of the price you set. For a free local-chain purchase use `examples/end-to-end` (step 0).

## 4a. Buy with the CLI
```powershell
npm install -g @turnspike-qie/cli
turnspike init --owner 0xYourOwner --keystore <path> --payee http://localhost:3000=0xYourMerchant --max-price 0.01
turnspike doctor
turnspike api pay http://localhost:3000/v1/quote --dry-run   # quote, price and gas; nothing is sent
turnspike api pay http://localhost:3000/v1/quote             # asks for confirmation; --yes to skip
turnspike api verify 0x<txHash>                              # decodes the payment from the chain
```
Run `turnspike --help` for all commands and exit codes. The CLI refuses to pay without `--yes` in a non-interactive shell.

## 4b. Buy with the SDK
```powershell
npm install @turnspike-qie/client ethers
```
```ts
import { TurnspikeClient, FileJournal, QIE_MAINNET } from "@turnspike-qie/client";
const client = new TurnspikeClient({
  signer, owner: "0xYourOwner", network: QIE_MAINNET,        // signer: the AGENT wallet connected to a QIE provider
  policy: { payees: [{ origin: "http://localhost:3000", merchant: "0xYourMerchant" }], maxPriceBase: 10_000n },
  journal: new FileJournal("./journal.json"),
});
const r = await client.fetch("http://localhost:3000/v1/quote", {}, { idempotencyKey: "my-first-purchase" });
if (r.ok) console.log(await r.response.json(), r.payment?.explorerUrl);
else console.log(r.error, r.message, "paid:", r.paid);        // paid:true means call client.resume(key) later
```
A worked, mainnet-proven version is `examples/node-agent` (see `evidence/M8_sdk_mainnet.md`).

## 5. Verify settlement and delivery
- The `explorerUrl` in the result, or `turnspike api verify <tx>`, shows the `Paid(owner, agent, merchant, requestId, amount)` event on https://mainnet.qie.digital.
- Re-running with the same idempotency key must **not** pay again; the result has `replayed: true`.
- `GET <gateway>/v1/payments/<requestId>` on the hosted gateway reports state without releasing data.

## What to expect to go wrong
Refusals cost nothing but gas: `untrusted_destination` (payee not in policy), `price_above_max`, `merchant_not_allowed`, `over_per_call_cap`, `over_daily_cap`, `insufficient_gas`. If you see `paid: true` with an error, the payment happened; resume with the same key.
