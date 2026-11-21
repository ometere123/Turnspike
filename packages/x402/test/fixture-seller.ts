// Child-process seller for the crash test: a real process exit inside the handler, after settle and before delivery.
import express from "express";
import { turnspike } from "@turnspike-qie/middleware";
import { x402Seller } from "../src";

const offset = Number(process.env.CLOCK_OFFSET ?? 0);
const mw = turnspike({
  rpcUrls: [process.env.RPC!], chainId: Number(process.env.CHAIN_ID), contract: process.env.VAULT!, token: process.env.TOKEN!,
  merchant: process.env.MERCHANT!, hmacSecrets: [process.env.HMAC_SECRET!], dbPath: process.env.DB!, confirmations: 1,
  deliveryLeaseSeconds: 2, prices: { "/report": 1000 }, x402: true, rateLimitPerMinute: 100_000, paymentGraceSeconds: 10 ** 9,
  clock: () => Math.floor(Date.now() / 1000) + offset,
  onEvent: () => {},
});
const app = express();
app.use("/v1", x402Seller(mw));
app.get("/v1/report", (_req, res) => {
  if (process.env.CRASH === "1") process.exit(1); // paid and settled, lease held, nothing stored
  res.json({ ok: true, deliveredBy: process.pid });
});
app.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("ready"));
