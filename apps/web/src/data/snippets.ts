/**
 * Code samples shown in the UI. They mirror the real packages: packages/middleware (turnspike), packages/client
 * (TurnspikeClient), packages/cli (turnspike) and examples/. Update them when those change.
 */
import { config } from "@/lib/config";

export const INSTALL_SNIPPET = `npm install @turnspike-qie/middleware express     # API providers
npm install @turnspike-qie/client ethers         # agent builders
npm install -g @turnspike-qie/cli                # the turnspike command`;

export const INTEGRATION_SNIPPET = `import express from "express";
import { turnspike } from "@turnspike-qie/middleware";

const app = express();
const paid = turnspike({
  rpcUrls: ["${config.rpcUrl}", "https://rpc2mainnet.qie.digital"],
  chainId: ${config.chainId},
  contract: "${config.allowance}",   // deployed TurnpikeAllowance
  token: "${config.qusdc}",          // QUSDC, 6 decimals
  merchant: process.env.MERCHANT_ADDRESS!,      // where payments go
  hmacSecrets: [process.env.HMAC_SECRET!],      // at least 32 bytes
  dbPath: "/data/turnspike.sqlite",             // persistent volume
  prices: {
    "/forecast/:city": {
      priceBase: 2500,                                     // 0.0025 QUSDC
      validate: (req) => /^[a-z-]+$/.test(req.path.split("/")[2] ?? "") ? null : "unknown_city", // 400 before any price
    },
  },
});
app.use("/v1", paid);
app.get("/v1/forecast/:city", (req, res) => res.json({ city: req.params.city, tomorrow: "sunny" }));

// recover payments made while you were down, then clean up challenges that can no longer be paid
setInterval(() => paid.reconcile().then(() => paid.purge()), 15 * 60_000);
app.listen(8080);`;

export const CLIENT_SNIPPET = `import { TurnspikeClient, FileJournal, QIE_MAINNET, parseUnits } from "@turnspike-qie/client";

const client = new TurnspikeClient({
  signer,                                  // the AGENT key (keystore, KMS, remote signer). Never the owner key.
  owner: "0xOwner…",                       // whose on-chain allowance pays
  network: QIE_MAINNET,
  policy: {
    payees: [{ origin: "https://api.example.com", merchant: "0xMerchant…" }], // nobody else is ever paid
    maxPriceBase: parseUnits("0.005"),     // hard ceiling per request
  },
  approve: (q) => q.gasCostWei < 10n ** 15n, // your rule, before every payment
  journal: new FileJournal(".turnspike/journal.json"), // restart-safe
});

const r = await client.fetch("https://api.example.com/v1/forecast/lagos", {}, { idempotencyKey: "lagos-today" });
if (r.ok && r.kind === "paid") console.log(await r.response.json(), r.payment.explorerUrl);
else if (!r.ok && r.paid) await client.resume("lagos-today"); // paid, not delivered yet: never pays twice`;

export const CLI_SNIPPET = `turnspike init --owner 0xOwner --keystore ~/.foundry/keystores/agent \\
  --payee ${config.gatewayUrl}=${config.merchant} --max-price 0.005
turnspike doctor
turnspike account inspect 0xOwner
turnspike api probe ${config.gatewayUrl}/v1/block-summary      # explains the 402, never pays
turnspike api pay ${config.gatewayUrl}/v1/block-summary        # shows price and gas, asks, pays
turnspike api verify 0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7
turnspike api pay … --json --yes | jq .payment.explorerUrl     # scripting; exit 3 = refused, 4 = paid or possibly paid, not delivered`;

export const CHALLENGE_JSON = `HTTP/1.1 402 Payment Required

{
  "error": "payment_required",
  "protocol": "turnspike/1",
  "requestId": "0x…",     // keccak256 of nonce, merchant, resource, price, chain, contract, expiry
  "sig": "…",             // HMAC-SHA256 over the same fields: the secret half of the proof
  "priceBase": "1000",
  "token": "${config.qusdc}",
  "contract": "${config.allowance}",
  "merchant": "${config.merchant}",
  "chainId": ${config.chainId},
  "resourceId": "block-summary",
  "expiresAt": 1795079974,
  "paymentDeadline": 1795080034  // must be mined by this chain time
}`;

export const PAY_SNIPPET = `// what @turnspike-qie/client does for you, after checking the payee, network, price, limits and gas
const vault = new Contract("${config.allowance}", [
  "function pay(address owner, address merchant, bytes32 requestId, uint256 amount)",
], agentSigner);
const tx = await vault.pay(ownerAddress, challenge.merchant, challenge.requestId, BigInt(challenge.priceBase));
await tx.wait(2);`;

export const PROOF_SNIPPET = `// retry the same request with the full proof; sig is required
const proof = btoa(JSON.stringify({ requestId, txHash: tx.hash, sig }));
const res = await fetch("https://your-api/v1/block-summary", { headers: { "X-Payment": proof } });

// 200 delivered | 202 pending (retry after retryAfter) | 400 invalid_request | 402 refused proof
// 403 wrong_resource | 409 already_redeemed | 429 rate_limited | 503 rpc_unavailable or storage_unavailable`;
