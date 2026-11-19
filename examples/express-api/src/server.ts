import express from "express";
import { turnspike } from "@turnspike/middleware";

// Every value below comes from the environment so the same file runs against QIE Mainnet or a local test chain.
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See README.md.`);
  return v;
}

const app = express();

app.use(
  "/v1",
  turnspike({
    rpcUrls: [process.env.RPC_URL ?? "https://rpc1mainnet.qie.digital"],
    chainId: Number(process.env.CHAIN_ID ?? 1990),
    contract: process.env.ALLOWANCE_ADDRESS ?? "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c", // TurnpikeAllowance (verified on the QIE explorer)
    token: process.env.QUSDC_ADDRESS ?? "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", // QUSDC, 6 decimals
    merchant: need("MERCHANT_ADDRESS"), // the address that receives the QUSDC
    hmacSecrets: [need("HMAC_SECRET")], // at least 32 bytes, keep it out of source control
    dbPath: process.env.DB_PATH ?? "./turnpike.sqlite",
    prices: {
      "/quote": 1000, // 1000 base units = 0.001 QUSDC
      "/report/:id": { priceBase: 5000 }, // each id is its own resource: paying for report 1 never unlocks report 2
    },
  }),
);

// Handlers run only after a verified payment. Keep them idempotent: after a crash the gateway may run one again.
app.get("/v1/quote", (_req, res) => res.json({ pair: "QIE/USDC", note: "replace with your real data", at: new Date().toISOString() }));
app.get("/v1/report/:id", (req, res) => res.json({ id: req.params.id, body: "replace with your paid resource" }));

app.get("/healthz", (_req, res) => res.json({ ok: true })); // not under /v1, so it is free

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`example API on :${port}`));
