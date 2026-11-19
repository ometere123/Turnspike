// Child-process server used by TEST-M09 so the crash is a real process exit, not a simulation.
import express from "express";
import { turnpike } from "../src";

const app = express();
const mw = turnpike({
  rpcUrls: [process.env.RPC!],
  chainId: Number(process.env.CHAIN_ID),
  contract: process.env.VAULT!,
  token: process.env.TOKEN!,
  merchant: process.env.MERCHANT!,
  hmacSecrets: [process.env.HMAC_SECRET!],
  dbPath: process.env.DB!,
  confirmations: 1,
  deliveryLeaseSeconds: 1,
  prices: { "/a": 1000 },
});
app.use("/paid", mw);
app.get("/paid/a", (_req, res) => {
  if (process.env.CRASH === "1") process.exit(1); // crash after PAID_CONFIRMED, before DELIVERED
  res.json({ ok: true, deliveredBy: process.pid });
});
app.listen(Number(process.env.PORT), () => console.log("ready"));
