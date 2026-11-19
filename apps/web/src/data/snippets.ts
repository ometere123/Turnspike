/**
 * Code samples shown in the UI. They mirror the real implementation in packages/middleware/src/index.ts
 * (turnpike(config)) and apps/gateway/src/agent.ts. Update them when those change.
 */
import { config } from "@/lib/config";

export const INTEGRATION_SNIPPET = `import express from "express";
import { turnpike } from "@turnpike/middleware"; // build packages/middleware first; not published to npm yet

const app = express();

app.use("/v1", turnpike({
  rpcUrls: ["${config.rpcUrl}", "https://rpc2mainnet.qie.digital"],
  chainId: ${config.chainId},
  contract: "${config.allowance}",
  token: "${config.qusdc}",
  merchant: "${config.merchant}",
  hmacSecrets: [process.env.HMAC_SECRET!], // at least 32 bytes
  dbPath: "/data/turnpike.sqlite",
  prices: { "/block-summary": 1000 },      // 1000 base units = 0.001 QUSDC
}));

app.get("/v1/block-summary", (_req, res) => res.json({ ok: true }));
app.listen(8080);`;

export const CHALLENGE_JSON = `HTTP/1.1 402 Payment Required

{
  "error": "payment_required",
  "requestId": "0x…",     // keccak256 of nonce, merchant, resource, price, chain, contract, expiry
  "sig": "…",             // HMAC-SHA256 over the same fields
  "priceBase": "1000",
  "token": "${config.qusdc}",
  "contract": "${config.allowance}",
  "merchant": "${config.merchant}",
  "chainId": ${config.chainId},
  "resourceId": "block-summary",
  "expiresAt": 1795057556
}`;

export const PAY_SNIPPET = `import { Contract } from "ethers";

const vault = new Contract("${config.allowance}", [
  "function pay(address owner, address merchant, bytes32 requestId, uint256 amount)",
], agentSigner);

// agentSigner is the key the owner authorised with setPolicy
const tx = await vault.pay(ownerAddress, challenge.merchant, challenge.requestId, BigInt(challenge.priceBase));
await tx.wait();`;

export const PROOF_SNIPPET = `// retry the same request with the proof. sig is the secret half: keep it private
const proof = btoa(JSON.stringify({ requestId, txHash: tx.hash, sig }));
const res = await fetch("https://your-api/v1/block-summary", { headers: { "X-Payment": proof } });

// 200 delivered | 202 pending (retry after retryAfter) | 402 invalid or rejected
// 403 wrong_resource | 409 already_redeemed | 429 rate_limited | 503 rpc_unavailable or storage_unavailable`;
