// Starts the example seller from environment variables. Local Hardhat chain only: see README.md.
// All values are addresses, URLs and a local HMAC secret; there is no private key.
import { createSeller } from "./seller";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`missing ${k}`); process.exit(2); }
  return v;
};

const { app } = createSeller({
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  chainId: Number(process.env.CHAIN_ID ?? 31337),
  contract: need("CONTRACT"),
  token: need("TOKEN"),
  merchant: need("MERCHANT"),
  hmacSecret: need("HMAC_SECRET"),
  dbPath: process.env.DB_PATH ?? "./seller.sqlite",
  priceBase: Number(process.env.PRICE_BASE ?? 2500),
  confirmations: Number(process.env.CONFIRMATIONS ?? 1),
  publicOrigin: process.env.PUBLIC_ORIGIN,
});
const port = Number(process.env.PORT ?? 8080);
app.listen(port, "127.0.0.1", () => console.log(`x402 seller on http://127.0.0.1:${port}/v1/report`));
